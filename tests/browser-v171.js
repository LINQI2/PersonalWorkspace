import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveRecord, transaction } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v171-edge-')),
  store = createApp(dir, { ai: { env: {} } }),
  db = store.getDb();
const form = (title) => ({
  type: 'note',
  title,
  url: '',
  description: '可核对的合成资料简介',
  content: '<h2>核心观点</h2><p>这是合成实验记录，保留真实来源与不同阶段的判断。</p>',
  cover_asset_id: null,
  pinned: 0,
  domains: [],
  tags: [],
  collections: [],
});
const note = saveEntry(db, form('阅读笔记')),
  tool = saveEntry(db, { ...form('实践工具'), resource_kind: 'tool', tool_kind: 'desktop' }),
  bookmark = saveEntry(db, {
    ...form('网页资料'),
    type: 'bookmark',
    url: 'https://example.com/research',
  });
const k = {
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
  doc = saveRecord(db, k),
  chapter = saveRecord(db, { ...k, kind: 'point', title: '研究章节' });
transaction(db, () => attach(db, { items: [{ id: chapter.id, parent_id: doc.id }] }));
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
  mkdirSync('test-results', { recursive: true });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: '快速记录', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/v1.7.1-home.png',
    fullPage: true,
    animations: 'disabled',
  });
  for (const name of ['收集箱', '知识库', 'AI 助手', '首页']) {
    await page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name, exact: true })
      .click();
    await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  const start = Date.now();
  await page.getByRole('textbox', { name: '快速记录正文' }).last().fill('十秒内记录的灵感');
  await page.getByRole('button', { name: '保存记录', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: '快速记录' })).toHaveCount(0);
  assert.ok(Date.now() - start < 10000);
  const captured = db.prepare("SELECT * FROM entries WHERE title='十秒内记录的灵感'").get();
  assert.ok(captured);
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '收集箱', exact: true })
    .click();
  await expect(page.getByRole('link', { name: '十秒内记录的灵感', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/v1.7.1-inbox.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '完成处理', exact: true }).click();
  await expect(page.getByRole('link', { name: '十秒内记录的灵感', exact: true })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await expect(page.locator('.unified-list')).toBeVisible();
  await expect(page.getByRole('button', { name: '阅读内容 十秒内记录的灵感' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/v1.7.1-library.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '置顶 十秒内记录的灵感' }).click();
  await page.getByRole('combobox', { name: '内容排序' }).selectOption('title');
  await expect(page.locator('.unified-card').first()).toContainText('十秒内记录的灵感');
  await page.getByRole('button', { name: '阅读内容 阅读笔记' }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await expect(page.locator('.reading-surface h1')).toHaveText('阅读笔记');
  await page.screenshot({
    path: 'test-results/v1.7.1-note.png',
    fullPage: true,
    animations: 'disabled',
  });
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await page.getByRole('tab', { name: '上下文 AI', exact: true }).click();
  await page.getByRole('button', { name: '就此内容询问 AI' }).click();
  await expect(page.getByRole('checkbox', { name: '证据 阅读笔记', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '证据 网页资料', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .locator('.reading-surface>.reading-back')
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '编辑条目', exact: true })).toBeVisible();
  await page.locator('.tiptap').fill('短笔记原位编辑后的合成判断，旧正文仍可恢复。');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('textbox', { name: '标题', exact: true }).press('Escape');
  await expect(page.locator('.tiptap')).toContainText('原位编辑');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('region', { name: '编辑条目', exact: true })).toHaveCount(0);
  assert.equal(
    db.prepare('SELECT count(*) n FROM content_versions WHERE entry_id=?').get(note.id).n,
    1,
  );
  await expect(page.locator('.detail-prose')).toContainText('原位编辑');
  await page.getByRole('button', { name: '← 返回列表' }).click();
  assert.equal(await page.getByRole('combobox', { name: '内容排序' }).inputValue(), 'title');
  const row = page
    .locator('.unified-card')
    .filter({ has: page.getByRole('button', { name: '阅读内容 十秒内记录的灵感', exact: true }) });
  await row.locator('.action-menu>summary').click();
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: '移入回收站' }).click();
  await expect(page.getByRole('button', { name: '阅读内容 十秒内记录的灵感' })).toHaveCount(0);
  assert.equal(
    db.prepare('SELECT content FROM entries WHERE id=?').get(captured.id).content,
    captured.content,
  );
  await page
    .locator('.global-topbar')
    .getByRole('button', { name: '设置', exact: true })
    .first()
    .click();
  await page.getByRole('tab', { name: '数据与备份', exact: true }).click();
  await page.getByRole('button', { name: '打开回收站', exact: true }).click();
  await page.getByRole('link', { name: '十秒内记录的灵感', exact: true }).waitFor();
  await page.locator('.action-menu>summary').last().click();
  await page.getByRole('button', { name: '恢复内容' }).click();
  await expect(page.getByRole('link', { name: '十秒内记录的灵感', exact: true })).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '回收站', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '设置', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '阅读内容 十秒内记录的灵感' })).toBeVisible();
  for (const [title, id] of [
    ['实践工具', tool.id],
    ['网页资料', bookmark.id],
    ['综合研究文档', doc.id],
  ]) {
    await page.getByRole('button', { name: '阅读内容 ' + title, exact: true }).click();
    if (title !== '综合研究文档')
      await page.getByRole('button', { name: '完整阅读', exact: true }).click();
    await expect(page.locator('.reading-surface')).toBeVisible();
    if (id === doc.id) {
      await page
        .getByRole('navigation', { name: '章节大纲' })
        .getByRole('button', { name: /研究章节/ })
        .click();
      await expect(page.locator('#chapter-' + chapter.id + ' .prose')).toBeVisible();
    }
    await page.screenshot({
      path:
        'test-results/v1.7.1-' +
        (id === tool.id ? 'tool' : id === bookmark.id ? 'bookmark' : 'document') +
        '.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '← 返回列表' }).click();
  }
  await page.getByRole('button', { name: '阅读内容 综合研究文档' }).click();
  await expect(page.locator('#chapter-' + chapter.id + ' .prose')).toBeVisible();
  await page.reload();
  await expect(page.locator('#chapter-' + chapter.id + ' .prose')).toBeVisible();
  await page.getByRole('button', { name: '← 返回列表' }).click();
  await page.locator('.global-topbar').getByRole('button', { name: '设置', exact: true }).click();
  await page.screenshot({
    path: 'test-results/v1.7.1-settings.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await expect(page.getByRole('heading', { name: /安全保存/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'API Key' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  for (const width of [1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    (await page.getByRole('button', { name: '收起或展开侧栏' }).getAttribute('aria-expanded')) ===
    'true'
  )
    await page.getByRole('button', { name: '收起或展开侧栏' }).click();
  await page.screenshot({
    path: 'test-results/v1.7.1-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '标签筛选', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '标签筛选', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'V1.7.1 real Edge task-workbench/top-sidebar navigation/global capture <10s/inbox same-ID completion/pin-sort/trash-restore/four readers/chapter refresh/settings/mobile PASS; no cloud calls',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
