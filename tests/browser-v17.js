import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveRecord, transaction, moveRecord } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
import { writeRelation, changeRelations, related } from '../app/server/relations.js';
import { fixtureKey, deepSeekFixtureResponse } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-relations-edge-'));
let calls = 0;
const store = createApp(dir, {
  ai: {
    env: { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
    transport: async (_url, init) => {
      calls++;
      const p = JSON.parse(JSON.parse(init.body).messages[1].content);
      assert.equal(p.mode, 'relations');
      assert.equal(p.sources.length, 2);
      return deepSeekFixtureResponse({
        status: 'ready',
        suggestions: [
          {
            from_id: p.sources[0].id,
            to_id: p.sources[1].id,
            type: 'conflict',
            note: '合成观点的关联依据，模型不判断孰真',
            evidence: p.sources.map((s) => ({ id: s.id, quote: s.text.trim().slice(0, 16) })),
            uncertainty: '还需核对资料上下文',
          },
        ],
        missing: [],
      });
    },
  },
});
const db = store.getDb(),
  form = (title) => ({
    type: 'note',
    resource_kind: 'knowledge',
    tool_kind: '',
    title,
    url: '',
    description: '',
    content:
      '<p>这是具有具体文字的合成实验记录，需要保留不同观点和原始日期，不确定结论不能自动成为事实。</p>',
    pinned: 0,
    cover_asset_id: null,
    domains: [],
    tags: [],
    collections: [],
  });
const a = saveEntry(db, form('知识笔记甲')),
  b = saveEntry(db, form('知识笔记乙')),
  c = saveEntry(db, form('实践工具丙'));
const base = {
    ...form('综合研究文档'),
    kind: 'page',
    directory_id: null,
    priority: 0,
    status: 'review',
    epistemic: 'ai_inference',
    questions: '',
    references: [],
    original_date: '2025-01-02',
    date_note: '',
  },
  doc = saveRecord(db, base),
  chapter = saveRecord(db, { ...base, title: '证据章节', kind: 'point' }),
  chapter2 = saveRecord(db, { ...base, title: '另一个章节', kind: 'point' });
transaction(db, () =>
  attach(db, {
    items: [
      { id: chapter.id, parent_id: doc.id },
      { id: chapter2.id, parent_id: doc.id },
    ],
  }),
);
changeRelations(db, () =>
  writeRelation(db, {
    from_id: b.id,
    to_id: c.id,
    type: 'dependency',
    note: '理解乙需要丙的实践资料',
    evidence: [],
    uncertainty: '',
  }),
);
const original = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
  server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  const closeSurface = async () => {
    const modal = page.getByRole('dialog').last();
    if (await modal.count()) await modal.getByRole('button', { name: '关闭', exact: true }).click();
    else await page.getByRole('button', { name: '← 返回列表', exact: true }).last().click();
  };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === baseUrl ? r.continue() : r.abort(),
  );
  await page.goto(baseUrl);
  await page.getByRole('link', { name: '知识笔记甲', exact: true }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await page.getByRole('tab', { name: '知识关联', exact: true }).click();
  await page.locator('.related-panel>summary').click();
  await page.getByRole('button', { name: '关联知识', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索关联目标' }).fill('证据章节');
  await page.getByRole('button', { name: '关联目标 证据章节' }).click();
  await page.getByRole('combobox', { name: '关联类型' }).selectOption('reference');
  await page.getByRole('textbox', { name: '关联依据' }).fill('甲明确引用研究文档的证据章节');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '保存人工关联' }).click();
  await expect(page.locator('.relation-row')).toContainText('人工建立');
  await expect(page.getByRole('button', { name: '引用：证据章节', exact: true })).toBeVisible();
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), original);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/v1.7-related.png', fullPage: true });
  await page.getByRole('button', { name: '引用：证据章节', exact: true }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('综合研究文档');
  await expect(page.locator('.reader-chapter').filter({ hasText: '证据章节' })).toContainText(
    '具体文字',
  );
  await page.locator('.reader-chapter').filter({ hasText: '证据章节' }).locator('summary').click();
  await page.getByRole('button', { name: '独立详情与关系', exact: true }).click();
  const info = page.getByRole('region', { name: '证据章节', exact: true });
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await info.getByRole('tab', { name: '知识关联', exact: true }).click();
  await info.locator('.related-panel>summary').click();
  await expect(info.getByRole('button', { name: '被引用：知识笔记甲', exact: true })).toBeVisible();
  await info.getByRole('button', { name: '被引用：知识笔记甲', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '知识笔记甲', exact: true, level: 1 }),
  ).toBeVisible();
  await page.locator('.related-panel>summary').click();
  await page.getByRole('button', { name: '关联知识', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索关联目标' }).fill('知识笔记乙');
  await page.getByRole('checkbox', { name: 'AI关联资料 知识笔记乙', exact: true }).check();
  await page.getByRole('button', { name: '预览输入与费用' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '生成关联建议', exact: true }).click();
  await expect(page.locator('.relation-ai-review')).toContainText('不判断孰真');
  assert.equal(related(db, a.id).length, 1);
  await page.getByRole('button', { name: '拒绝所有建议' }).click();
  assert.equal(related(db, a.id).length, 1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '生成关联建议', exact: true }).click();
  await page.getByRole('checkbox', { name: '采用关联建议 0' }).check();
  await page
    .getByRole('textbox', { name: 'AI关联依据 0' })
    .fill('人工编辑后的冲突候选，保留两方原文');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '采用所选关联候选' }).click();
  await expect(page.locator('.relation-row')).toHaveCount(2);
  await expect(
    page.locator('.relation-row').filter({ hasText: '人工编辑后的冲突候选' }),
  ).toContainText('待确认');
  const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
  assert.equal(before, original);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '确认关系', exact: true }).click();
  await expect(
    page.locator('.relation-row').filter({ hasText: '人工编辑后的冲突候选' }),
  ).toContainText('已确认');
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await page.getByRole('button', { name: '知识探索', exact: true }).click();
  await page.getByRole('combobox', { name: '地图中心' }).selectOption(a.id);
  await expect(page.locator('.map-list')).toContainText('证据章节');
  assert.equal(await page.locator('.knowledge-map g[role=button]').count(), 3);
  await page.getByRole('combobox', { name: '地图层数' }).selectOption('2');
  await expect(page.locator('.knowledge-map g[role=button]')).toHaveCount(5);
  await page.getByRole('checkbox', { name: '地图关系 引用' }).check();
  await expect(page.locator('.knowledge-map g[role=button]')).toHaveCount(2);
  await page.getByRole('checkbox', { name: '地图关系 引用' }).uncheck();
  await page.getByRole('button', { name: '切换列表' }).click();
  await expect(page.locator('.knowledge-map')).toHaveCount(0);
  await expect(page.locator('.map-list')).toContainText('依赖');
  await page.getByRole('button', { name: '切换地图' }).click();
  await page.screenshot({ path: 'test-results/v1.7-map.png', fullPage: true });
  const target = page
    .locator('.knowledge-map g[role=button]')
    .filter({ has: page.locator('title', { hasText: '证据章节' }) });
  await target.focus();
  await target.press('Enter');
  await expect(page.locator('.knowledge-reader h1')).toHaveText('综合研究文档');
  await expect(page.locator('.reader-chapter').filter({ hasText: '证据章节' })).toContainText(
    '具体文字',
  );
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('link', { name: '知识笔记甲', exact: true }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page.locator('.reading-surface .action-menu>summary').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(page.locator('.error')).toContainText('仍有知识关联');
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 6);
  await closeSurface();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await page.getByRole('button', { name: '知识探索', exact: true }).click();
  await page.getByRole('combobox', { name: '地图中心' }).selectOption(a.id);
  await page.getByRole('button', { name: '切换列表' }).click();
  await page.screenshot({ path: 'test-results/v1.7-map-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await closeSurface();
  await page.goto(baseUrl + '/#chapter-' + chapter.id);
  await expect(page.locator('.knowledge-reader h1')).toHaveText('综合研究文档');
  await expect(page.locator('.reader-chapter').filter({ hasText: '证据章节' })).toContainText(
    '具体文字',
  );
  assert.deepEqual(errors, []);
  assert.equal(calls, 2);
  console.log(
    'V1.7 Edge manual link/backlink/chapter jump/AI reject-edit-adopt-confirm/deletion protection/map1-2/filter/keyboard/list/mobile PASS; mock calls=2',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
