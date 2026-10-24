import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { prepareImport, commitImport } from '../app/server/knowledge/importer.js';
import { saveRecord, getRecord } from '../app/server/knowledge/store.js';
import { readingPackage, knowledgeForm, integrationPlan } from './knowledge-reading-fixture.js';
import { commitBody } from './knowledge-fixture.js';
import { deepSeekFixtureResponse, fixtureKey } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-reading-edge-'));
const store = createApp(dir, {
  ai: {
    env: { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
    transport: async (_url, init) => {
      const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
      return deepSeekFixtureResponse(integrationPlan(payload.sources));
    },
  },
});
const db = store.getDb(),
  p = prepareImport(db, JSON.stringify(readingPackage())),
  imported = commitImport(db, p.prepared, {
    ...commitBody(p.preview),
    approvedDirectories: ['research'],
  });
const before = JSON.stringify(
  db.prepare('SELECT id,title,content,created_at FROM entries ORDER BY id').all(),
);
const sourceBefore = JSON.stringify(
  db.prepare('SELECT * FROM knowledge_sources ORDER BY id').all(),
);
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await page.goto(base);
  await page.getByRole('button', { name: '知识目录', exact: true }).click();
  await expect(page.locator('.knowledge-row')).toHaveCount(1);
  mkdirSync('test-results', { recursive: true });
  await page.getByRole('button', { name: '查看所有知识点', exact: true }).click();
  await expect(page.locator('.knowledge-row')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/v1.5-b-before-flat.png' });
  await page.getByRole('button', { name: '恢复页面优先', exact: true }).click();
  await expect(page.locator('.knowledge-row')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/v1.5-b-directory.png' });
  await page.getByRole('button', { name: '阅读知识 模拟研究阅读页', exact: true }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('模拟研究阅读页');
  await page.getByRole('button', { name: '整理模式', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '采用显式归属建议 (9)', exact: true }).click();
  await expect(page.locator('.reader-chapter')).toHaveCount(9);
  assert.equal(
    JSON.stringify(db.prepare('SELECT id,title,content,created_at FROM entries ORDER BY id').all()),
    before,
  );
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM knowledge_sources ORDER BY id').all()),
    sourceBefore,
  );
  await page.getByRole('button', { name: '下移章节 研究章节 1', exact: true }).click();
  await expect(page.locator('.reader-chapter').nth(1)).toContainText('研究章节 1');
  await page
    .getByRole('combobox', { name: '章节归属 研究章节 3', exact: true })
    .selectOption(imported.ids['point-1']);
  await expect(page.locator('.reader-chapter.depth-1')).toHaveCount(2);
  const extra = saveRecord(db, knowledgeForm('已有独立观察'));
  await page.getByRole('button', { name: '收纳已有知识点', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '收纳已有知识点', exact: true });
  await modal.getByRole('textbox', { name: '寻找待收纳知识', exact: true }).fill('已有独立观察');
  await modal.getByRole('button', { name: '选择本页独立知识点', exact: true }).click();
  await expect(
    modal.getByRole('checkbox', { name: '已有独立观察 独立知识点', exact: true }),
  ).toBeChecked();
  await modal.getByRole('button', { name: '收纳所选知识', exact: true }).click();
  await expect(modal).toHaveCount(0);
  assert.equal(getRecord(db, extra.id).content, extra.content);
  await expect(page.locator('.reader-chapter')).toHaveCount(10);
  await page.getByRole('checkbox', { name: '选择章节 研究章节 1', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择章节 研究章节 2', exact: true }).check();
  await page.getByRole('button', { name: '分析选中知识 (2)', exact: true }).click();
  modal = page.getByRole('dialog', { name: '知识整合方案 · 人工审核', exact: true });
  await expect(modal.locator('.integration-estimate')).toContainText('2 条');
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '生成候选整合方案', exact: true }).click();
  await expect(modal.getByRole('textbox', { name: '整合章节标题 0', exact: true })).toBeVisible();
  await expect(modal).toContainText('相同实验原则');
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 11);
  await modal.getByRole('button', { name: '拒绝并关闭', exact: true }).click();
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 11);
  await page.getByRole('button', { name: '分析选中知识 (2)', exact: true }).click();
  modal = page.getByRole('dialog', { name: '知识整合方案 · 人工审核', exact: true });
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '生成候选整合方案', exact: true }).click();
  await modal
    .getByRole('textbox', { name: '整合章节标题 0', exact: true })
    .fill('人工修改的整合章');
  await expect(modal).toContainText('本次未调用 API');
  await modal
    .getByRole('textbox', { name: '关系依据说明 0', exact: true })
    .fill('人工核对：互补观察，保留来源。');
  await page.screenshot({ path: 'test-results/v1.5-b-integration-review.png' });
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '采用所选建议', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.reader-chapter')).toHaveCount(11);
  assert.equal(
    JSON.stringify(
      db
        .prepare(
          'SELECT id,title,content,created_at FROM entries WHERE id IN (' +
            Object.values(imported.ids)
              .map(() => '?')
              .join(',') +
            ') ORDER BY id',
        )
        .all(...Object.values(imported.ids)),
    ),
    before,
  );
  await page.getByRole('button', { name: '阅读模式', exact: true }).click();
  await page
    .getByRole('navigation', { name: '章节大纲', exact: true })
    .getByRole('button')
    .filter({ hasText: '研究章节 9' })
    .click();
  await expect(
    page.locator('.reader-chapter').filter({ hasText: '研究章节 9' }).locator('.knowledge-prose'),
  ).toContainText('独特关键词章节9');
  await page.locator('.knowledge-reader').scrollIntoViewIfNeeded();
  await page.locator('.knowledge-reader').screenshot({ path: 'test-results/v1.5-b-reader.png' });
  await page.getByRole('button', { name: '返回知识列表', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索知识', exact: true }).fill('独特关键词章节4');
  await page.getByRole('button', { name: '阅读知识 研究章节 4', exact: true }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('模拟研究阅读页');
  await expect(
    page.locator('#chapter-' + imported.ids['point-3'] + ' .knowledge-prose'),
  ).toContainText('独特关键词章节4');
  await page.getByRole('button', { name: /^全部收藏/ }).click();
  await page.getByRole('textbox', { name: '搜索收藏', exact: true }).fill('独特关键词章节4');
  await page.getByRole('button', { name: '查看 研究章节 4', exact: true }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('模拟研究阅读页');
  await expect(
    page.locator('#chapter-' + imported.ids['point-3'] + ' .knowledge-prose'),
  ).toContainText('独特关键词章节4');
  await page.reload();
  await page.getByRole('button', { name: '知识目录', exact: true }).click();
  await expect(page.locator('.knowledge-row')).toHaveCount(1);
  await page.getByRole('button', { name: '阅读知识 模拟研究阅读页', exact: true }).click();
  await expect(page.locator('.reader-chapter')).toHaveCount(11);
  assert.equal(
    db
      .prepare('SELECT position FROM knowledge_structure WHERE entry_id=?')
      .get(imported.ids['point-0']).position,
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/v1.5-b-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({ path: 'test-results/v1.5-b-dark.png' });
  await page.getByRole('button', { name: '导入知识', exact: true }).click();
  modal = page.getByRole('dialog', { name: '导入与人工审核', exact: true });
  await modal
    .getByRole('textbox', { name: '知识导入原文', exact: true })
    .fill(JSON.stringify(readingPackage()));
  await modal.getByRole('button', { name: '本地解析并预览', exact: true }).click();
  await expect(modal.locator('.import-hierarchy')).toContainText('模拟研究阅读页');
  await expect(modal.getByRole('combobox', { name: '审核归属 point-8', exact: true })).toHaveValue(
    'point-7',
  );
  await modal.getByRole('combobox', { name: '审核归属 point-8', exact: true }).selectOption('page');
  await page.screenshot({ path: 'test-results/v1.5-b-import-hierarchy.png' });
  await modal.getByRole('textbox', { name: '审核标题 page', exact: true }).fill('第二份审核页面');
  await modal.getByRole('checkbox', { name: '允许重复导入', exact: true }).check();
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '确认导入所选知识', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: '阅读知识 第二份审核页面', exact: true }).click();
  await expect(page.locator('.reader-chapter')).toHaveCount(9);
  const secondPage = db.prepare("SELECT id FROM entries WHERE title='第二份审核页面'").get().id;
  assert.equal(
    db.prepare('SELECT count(*) n FROM knowledge_structure WHERE parent_id=?').get(secondPage).n,
    9,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS Edge V1.5-B: page-first, explicit legacy collection, 9 chapters, parent/order, existing stable record, search locate, AI mock reject/edit/adopt, reload, hierarchy review, mobile/dark, 0 pageerror',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
