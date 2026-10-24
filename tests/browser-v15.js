import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { fixtureForm } from './ai-fixture.js';
import { exchangeFixture } from './knowledge-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-knowledge-edge-'));
const store = createApp(dir, {
    ai: {
      env: {},
      transport: () => {
        throw Error('Cloud calls forbidden');
      },
    },
  }),
  db = store.getDb();
db.prepare('INSERT INTO collections VALUES(?,?)').run('old-topic', '原专题');
saveEntry(db, {
  ...fixtureForm,
  title: '源网址示例',
  url: 'https://example.com/reference',
  collections: ['old-topic'],
});
saveEntry(db, {
  ...fixtureForm,
  type: 'note',
  resource_kind: 'tool',
  tool_kind: 'desktop',
  url: '',
  title: '桌面工具示例',
});
const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
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
  const openImport = () =>
    page
      .locator('.knowledge-actions')
      .getByRole('button', { name: '导入知识', exact: true })
      .click();
  await openImport();
  let panel = page.getByRole('dialog', { name: '导入与人工审核', exact: true });
  const templateDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载示例模板', exact: true }).click();
  const template = await templateDownload;
  assert.equal(
    JSON.parse(readFileSync(await template.path(), 'utf8')).format,
    'personal-knowledge-exchange',
  );
  await panel.getByRole('textbox', { name: '知识导入原文' }).fill('{');
  await panel.getByRole('button', { name: '本地解析并预览', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('JSON 无法解析');
  const fixture = JSON.stringify(exchangeFixture());
  await panel.getByRole('textbox', { name: '知识导入原文' }).fill(fixture);
  await panel.getByRole('button', { name: '本地解析并预览', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: '审核标题 point-1', exact: true })).toBeVisible();
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
  await expect(panel.getByRole('combobox', { name: '审核状态 point-3', exact: true })).toHaveValue(
    'review',
  );
  await expect(panel.getByRole('textbox', { name: '审核日期 point-2', exact: true })).toHaveValue(
    '',
  );
  await panel.getByRole('checkbox', { name: '导入 point-2', exact: true }).uncheck();
  await panel
    .getByRole('textbox', { name: '审核标题 point-1', exact: true })
    .fill('小样本实验 · 人工审核');
  for (const name of [
    '确认创建领域 学习方法',
    '确认创建标签 待核对',
    '确认创建专题收藏夹 实验笔记',
    '确认创建目录 研究方法',
    '确认创建目录 实践记录',
  ]) {
    const c = panel.getByRole('checkbox', { name, exact: true });
    await expect(c).not.toBeChecked();
    await c.check();
  }
  await panel.getByRole('checkbox', { name: /保留选中条目间的关系建议/ }).check();
  mkdirSync('test-results', { recursive: true });
  await panel.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/v1.5-a-import-review.png', animations: 'disabled' });
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '确认导入所选知识', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '目录 研究方法 / 实践记录', exact: true }).click();
  await expect(page.locator('.knowledge-row')).toHaveCount(2);
  await page.getByRole('button', { name: '上移知识 对原结论的修正', exact: true }).click();
  await expect(page.locator('.knowledge-row').first()).toContainText('对原结论的修正');
  await page.getByRole('button', { name: '阅读知识 小样本实验 · 人工审核', exact: true }).click();
  await expect(page.locator('.knowledge-document')).toContainText('2026-09-20');
  await expect(page.locator('.knowledge-document')).toContainText('2026-09-22T09:00:00+08:00');
  await expect(page.locator('.knowledge-document')).toContainText('尚未人工确认');
  await page.getByRole('button', { name: '查看导入原文', exact: true }).click();
  const sourceDialog = page.getByRole('dialog', { name: '导入来源原文', exact: true });
  await expect(sourceDialog.locator('pre')).toContainText('17天、320元');
  await sourceDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑知识', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '编辑知识', exact: true });
  await editor.getByRole('combobox', { name: '知识状态', exact: true }).selectOption('confirmed');
  page.once('dialog', (d) => d.accept());
  await editor.getByRole('button', { name: '保存知识', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.knowledge-document')).toContainText('用户确认此版本');
  await page.screenshot({
    path: 'test-results/v1.5-a-knowledge-detail.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '快速收集箱', exact: true }).click();
  await page
    .locator('.knowledge-actions')
    .getByRole('button', { name: '快速收集', exact: true })
    .click();
  editor = page.getByRole('dialog', { name: '收集与新建知识', exact: true });
  await editor.getByRole('textbox', { name: '知识标题', exact: true }).fill('个人灵感收集');
  await editor.locator('.tiptap').fill('原始灵感文字，保留实践经验，不自动拆分。');
  page.once('dialog', (d) => d.accept());
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page
    .locator('.knowledge-actions')
    .getByRole('button', { name: '快速收集', exact: true })
    .click();
  editor = page.getByRole('dialog', { name: '收集与新建知识', exact: true });
  await editor.getByRole('button', { name: '恢复知识草稿', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: '知识标题', exact: true })).toHaveValue(
    '个人灵感收集',
  );
  await expect(editor.locator('.tiptap')).toContainText('原始灵感文字');
  await editor.getByRole('textbox', { name: '知识原始日期', exact: true }).fill('2026-09-27');
  await editor.getByRole('button', { name: '保存知识', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.knowledge-document')).toContainText('2026-09-27');
  await page
    .locator('.knowledge-actions')
    .getByRole('button', { name: '新建混合页面', exact: true })
    .click();
  editor = page.getByRole('dialog', { name: '收集与新建知识', exact: true });
  await editor.getByRole('textbox', { name: '知识标题', exact: true }).fill('实践知识页面');
  await editor.locator('.tiptap').fill('把知识结论、原始资源与实用工具放在同一个阅读页面。');
  await editor
    .getByRole('combobox', { name: '知识目录', exact: true })
    .selectOption({ label: '研究方法' });
  await editor.locator('summary').filter({ hasText: '关联已有资源' }).click();
  for (const name of ['源网址示例', '桌面工具示例'])
    await editor.getByRole('checkbox', { name, exact: true }).check();
  for (const name of ['原专题', '实验笔记'])
    await editor.getByRole('button', { name, exact: true }).click();
  await editor.getByRole('button', { name: '保存知识', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.knowledge-reference-grid button')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/v1.5-a-mixed-page.png', animations: 'disabled' });
  await page.getByRole('button', { name: '查看关联 源网址示例', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '收藏详情' })).toContainText('源网址示例');
  await page
    .getByRole('dialog', { name: '收藏详情' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: '知识目录', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索知识', exact: true }).fill('实践知识页面');
  await page.getByRole('button', { name: '阅读知识 实践知识页面', exact: true }).click();
  await expect(page.locator('.knowledge-reference-grid button')).toHaveCount(2);
  await openImport();
  panel = page.getByRole('dialog', { name: '导入与人工审核', exact: true });
  await panel.getByLabel('知识导入文件').setInputFiles({
    name: 'chatgpt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture),
  });
  await panel.getByRole('button', { name: '本地解析并预览', exact: true }).click();
  await expect(panel.getByText(/检测到同一份资料已导入/)).toBeVisible();
  await expect(panel.getByRole('button', { name: '确认导入所选知识', exact: true })).toBeDisabled();
  await panel.getByRole('checkbox', { name: '允许重复导入', exact: true }).check();
  await panel.getByRole('checkbox', { name: '导入 point-1', exact: true }).uncheck();
  await panel.getByRole('checkbox', { name: '导入 point-3', exact: true }).uncheck();
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '确认导入所选知识', exact: true }).click();
  await expect(panel).toHaveCount(0);
  assert.equal(db.prepare('SELECT count(*) n FROM knowledge_records').get().n, 5);
  await openImport();
  panel = page.getByRole('dialog', { name: '导入与人工审核', exact: true });
  const markdown = '# 对话原文\n- 不猜测拆分\n<script>只作为原文</script>';
  await panel
    .getByLabel('知识导入文件')
    .setInputFiles({ name: 'raw.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await panel.getByRole('button', { name: '本地解析并预览', exact: true }).click();
  await expect(panel.locator('.knowledge-review-item')).toHaveCount(1);
  await panel
    .getByRole('textbox', { name: '审核标题 raw-record', exact: true })
    .fill('原始对话收集');
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '确认导入所选知识', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '快速收集箱', exact: true }).click();
  await page.getByRole('button', { name: '阅读知识 原始对话收集', exact: true }).click();
  await expect(page.locator('.knowledge-prose')).toContainText('<script>只作为原文</script>');
  await expect(page.locator('.knowledge-prose script')).toHaveCount(0);
  await expect(page.locator('.knowledge-document')).toContainText('原始日期：未知');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/v1.5-a-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/v1.5-a-dark.png', animations: 'disabled' });
  const note = await (await fetch(base + '/api/knowledge/records?inbox=1')).json();
  assert.equal(note.total, 2);
  assert.deepEqual(errors, []);
  const originalIds = JSON.parse(before).map((r) => r.id);
  assert.equal(
    JSON.stringify(
      db.prepare('SELECT * FROM entries WHERE id IN (?,?) ORDER BY id').all(...originalIds),
    ),
    before,
  );
  console.log(
    'PASS actual Edge V1.5-A: local JSON/file/Markdown review, partial edit/create/reject, original sources/dates, same-name and repeat handling, explicit confirmation, directories/order, capture/mixed resources/cross-topic, restart UI, safe text, dark/mobile; zero cloud calls/page errors.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
