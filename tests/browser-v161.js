import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { assistantResponse } from './assistant-fixture.js';
import { fixtureKey, deepSeekFixtureResponse } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-unified-edge-'));
let calls = 0;
const store = createApp(dir, {
  ai: {
    env: { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
    transport: async (_url, init) => {
      calls++;
      const p = JSON.parse(JSON.parse(init.body).messages[1].content);
      return deepSeekFixtureResponse(assistantResponse(p));
    },
  },
});
const db = store.getDb();
db.prepare('INSERT INTO tags VALUES(?,?)').run('tag-a', 'AI工具');
db.prepare('INSERT INTO tags VALUES(?,?)').run('tag-b', 'AI 工具');
db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '合成专题');
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
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
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await page.goto(base);
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: /知识库/ })).toBeVisible();
  await page.getByText('管理与导入', { exact: true }).click();
  await page.getByRole('button', { name: '管理领域树' }).click();
  await page.getByRole('textbox', { name: '领域名称', exact: true }).fill('手工领域');
  await page.getByRole('button', { name: '创建领域', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '浏览领域 手工领域' }),
  ).toBeVisible();
  await closeSurface();
  await page.getByText('管理与导入', { exact: true }).click();
  await page.getByRole('button', { name: '统一导入', exact: true }).click();
  const sample = JSON.parse(readFileSync('docs/examples/content-v2-success.json', 'utf8'));
  sample.items[4].body += '这些只是合成观察，尚未得到独立验证。';
  sample.items.push(
    ...Array.from({ length: 8 }, (_, i) => ({
      ...sample.items[4],
      id: 'section-' + i,
      title: '合成研究章节 ' + (i + 2),
    })),
  );
  await page.getByRole('textbox', { name: '统一导入原文' }).fill(JSON.stringify(sample));
  await page.getByRole('button', { name: '本地解析并预览' }).click();
  await expect(page.locator('.hierarchy-preview')).toContainText('合成研究章节 9');
  await page.getByRole('textbox', { name: '标题 note', exact: true }).fill('已审核实验笔记');
  await page.getByLabel('创建领域 合成研究领域', { exact: true }).check();
  await page.getByLabel(/创建领域 合成实践子领域/).check();
  await page.getByLabel('collections note', { exact: true }).selectOption('topic');
  // Compact the real preview with its own disclosure controls, not injected application state.
  for (const summary of await page.locator('.import-review-card>summary').all())
    await summary.click();
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/v1.6.1-import-review.png', fullPage: true });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '确认写入所选内容' }).click();
  await expect(page.locator('.unified-card')).toHaveCount(4);
  assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 13);
  assert.equal(db.prepare('SELECT count(*) n FROM knowledge_structure').get().n, 9);
  await page.getByRole('button', { name: '浏览领域 合成研究领域' }).click();
  await expect(page.locator('.unified-card')).toHaveCount(3);
  await page.getByRole('button', { name: '折叠领域 合成研究领域' }).click();
  await expect(page.getByRole('button', { name: '浏览领域 合成实践子领域' })).toHaveCount(0);
  await page.getByRole('button', { name: '折叠领域 合成研究领域' }).click();
  await page.getByRole('button', { name: '全部领域', exact: true }).click();
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.locator('.unified-tool>details>summary').click();
  await expect(page.locator('.unified-tool .prose')).toContainText('不会启动本地程序');
  // Pre-existing saved views remain accessible, but this version adds no new shortcut creation UI.
  db.prepare('INSERT INTO library_views VALUES(?,?,?,?)').run(
    'legacy-view',
    '常用工具',
    JSON.stringify({ domains: [], tags: [], types: ['tool'] }),
    0,
  );
  await page.reload();
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await page.locator('.library-results .legacy-views>summary').click();
  await page.getByRole('button', { name: '常用工具', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('button', { name: '综合文档', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '阅读内容 实验综合文档' }).click();
  await expect(page.locator('.reader-outline button')).toHaveCount(11);
  await page
    .locator('.reader-outline')
    .getByRole('button', { name: /证据与待验证事项/ })
    .click();
  await expect(page.locator('.reader-chapter').first()).toContainText('先建立可检验假设');
  await page.screenshot({ path: 'test-results/v1.6.1-document.png', fullPage: true });
  await page.getByRole('button', { name: '整理模式', exact: true }).click();
  await page
    .locator('.reader-chapter')
    .filter({ hasText: '证据与待验证事项' })
    .getByRole('button', { name: /管理章节/ })
    .click();
  await page.getByRole('button', { name: '下移章节 证据与待验证事项', exact: true }).click();
  const original = db
    .prepare(
      'SELECT e.id,e.content,e.title,s.source_id FROM entries e LEFT JOIN content_source_links s ON s.entry_id=e.id ORDER BY e.id',
    )
    .all();
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('textbox', { name: '统一搜索' }).fill('合成研究章节 9');
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '阅读内容 合成研究章节 9' }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('实验综合文档');
  await expect(page.locator('.reader-chapter').filter({ hasText: '合成研究章节 9' })).toContainText(
    '可检验假设',
  );
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('textbox', { name: '统一搜索' }).fill('');
  await page.getByRole('button', { name: '专题筛选', exact: true }).click();
  await page
    .getByRole('group', { name: '专题可选值' })
    .getByRole('button', { name: '合成专题', exact: true })
    .click();
  await page.getByRole('button', { name: '专题动态筛选规则' }).click();
  await page.getByLabel('规则 types', { exact: true }).selectOption('tool');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '确认规则', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(2);
  assert.equal(db.prepare('SELECT count(*) n FROM entry_collections').get().n, 1);
  await page.getByRole('button', { name: '打开专题总结' }).click();
  await expect(page.getByRole('heading', { name: '合成专题', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await page.getByRole('button', { name: '阅读内容 已审核实验笔记' }).click();
  await page.getByText('来源与原始导入记录', { exact: true }).click();
  await expect(page.getByText('查看原始导入包', { exact: true })).toBeVisible();
  await closeSurface();
  await page.getByText('管理与导入', { exact: true }).click();
  await page.getByRole('button', { name: '统一导入', exact: true }).click();
  await page.getByRole('textbox', { name: '统一导入原文' }).fill(JSON.stringify(sample));
  await page.getByRole('button', { name: '本地解析并预览' }).click();
  await expect(page.locator('.draft-banner')).toContainText('检测到重复导入');
  page.once('dialog', (d) => d.accept());
  await closeSurface();
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 13);
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: 'AI 助手', exact: true })
    .click();
  await page.getByRole('textbox', { name: '知识助手问题' }).fill('证据');
  await page.getByRole('button', { name: '本地检索证据' }).click();
  await page.getByRole('button', { name: '清空证据选择' }).click();
  await page.getByRole('checkbox', { name: '证据 证据与待验证事项', exact: true }).check();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '根据所选证据回答' }).click();
  await expect(page.locator('.assistant-answer')).toContainText('模型推断');
  assert.equal(calls, 1);
  assert.deepEqual(
    db
      .prepare(
        'SELECT e.id,e.content,e.title,s.source_id FROM entries e LEFT JOIN content_source_links s ON s.entry_id=e.id ORDER BY e.id',
      )
      .all(),
    original,
  );
  await page
    .locator('.assistant-answer')
    .getByRole('button', { name: '证据与待验证事项', exact: true })
    .first()
    .click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('实验综合文档');
  await closeSurface();
  await expect(page.getByRole('button', { name: /目录 / })).toHaveCount(0);
  await expect(page.locator('.active-filters')).toContainText('合成专题');
  await page.getByRole('button', { name: '重置全部筛选', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/v1.6.1-library.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/v1.6.1-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('.sidebar nav > button').first()).toHaveCSS(
    'background-color',
    'rgb(33, 46, 40)',
  );
  await page.screenshot({ path: 'test-results/v1.6.1-dark.png', fullPage: true });
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('combobox', { name: '工具类型筛选' }).selectOption('custom');
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加工具', exact: true });
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('临时工具体验回归');
  await editor.getByRole('combobox', { name: '工具类型', exact: true }).selectOption('custom');
  await editor.getByRole('textbox', { name: '简介', exact: true }).fill('无网址工具用途');
  await editor.locator('.tiptap').fill('可检索的个人实践经验 toolsregressiontext');
  const icon = await sharp({
    create: { width: 50, height: 50, channels: 4, background: '#26786b' },
  })
    .png()
    .toBuffer();
  await editor
    .getByLabel('上传封面', { exact: true })
    .setInputFiles({ name: 'synthetic-icon.png', mimeType: 'image/png', buffer: icon });
  await expect(editor.locator('.cover-upload img')).toBeVisible();
  await editor
    .locator('.taxonomy-selects')
    .getByRole('button', { name: '手工领域', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: '主要领域', exact: true })
    .selectOption({ label: '手工领域' });
  await editor.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.locator('.unified-card')).toHaveCount(2);
  await page.getByRole('textbox', { name: '统一搜索' }).fill('toolsregressiontext');
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await expect(page.locator('.unified-card img')).toBeVisible();
  if (!(await page.getByRole('checkbox', { name: '选择内容 临时工具体验回归' }).count()))
    await page.getByText('管理与导入', { exact: true }).click();
  await page.getByRole('button', { name: '多选管理' }).click();
  await page.getByRole('checkbox', { name: '选择内容 临时工具体验回归' }).check();
  await page.getByRole('button', { name: '置顶所选', exact: true }).click();
  await expect(page.locator('.unified-card-top')).toContainText('已置顶');
  await page.getByRole('checkbox', { name: '选择内容 临时工具体验回归' }).check();
  await page.getByRole('button', { name: '取消置顶所选', exact: true }).click();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('.unified-cards')).toHaveClass(/unified-list/);
  await page.getByRole('button', { name: '阅读内容 临时工具体验回归' }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '简介', exact: true }).fill('修改后的用途');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.locator('.unified-card')).toContainText('修改后的用途');
  await page.getByRole('button', { name: '阅读内容 临时工具体验回归' }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page.locator('.reading-surface .action-menu>summary').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page.getByRole('button', { name: '← 返回列表' }).click();
  await expect(page.locator('.unified-card')).toHaveCount(0);
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 14); // recycled tool remains stored
  assert.deepEqual(errors, []);
  console.log(
    'V1.6.1 real Edge: import4types/9chapters/domain tree/saved views/read/search/sort/rules/manual members/provenance/repeat/AI citations/mobile/dark PASS; mocked calls=' +
      calls,
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
