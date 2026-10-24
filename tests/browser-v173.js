import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveRecord, transaction } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
import { validateBackup } from '../app/server/backup.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v173-edge-')),
  store = createApp(dir, { ai: { env: {} } }),
  db = store.getDb();
const form = (title) => ({
  type: 'note',
  title,
  url: '',
  description: '可核对的合成资料简介',
  content:
    '<h2>核心观点</h2>' +
    Array.from(
      { length: 50 },
      (_, i) => '<p>合成段落 ' + i + '：保留证据、来源和不同阶段判断，用于长文阅读测试。</p>',
    ).join(''),
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
db.prepare('INSERT INTO domains VALUES(?,?)').run('root', '研究领域');
db.prepare('INSERT INTO domains VALUES(?,?)').run('child', '人物模拟与本地模型的研究实践长名称');
db.prepare('INSERT INTO domain_structure VALUES(?,?,?)').run('root', null, 0);
db.prepare('INSERT INTO domain_structure VALUES(?,?,?)').run('child', 'root', 0);
db.prepare('INSERT INTO tags VALUES(?,?)').run('tag', '实践');
db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '研究专题');
for (const kind of ['domains', 'tags', 'collections'])
  db.prepare('INSERT INTO entry_' + kind + ' VALUES(?,?)').run(
    note.id,
    { domains: 'child', tags: 'tag', collections: 'topic' }[kind],
  );
const children = Array.from({ length: 8 }, (_, i) =>
  saveRecord(db, {
    ...k,
    kind: 'point',
    title: '章节 ' + (i + 2),
    content: '<p>可核对的合成章节正文</p>'.repeat(35),
  }),
);
transaction(db, () =>
  attach(db, {
    items: children.map((c, i) => ({ id: c.id, parent_id: i === 1 ? children[0].id : doc.id })),
  }),
);
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  mkdirSync('test-results', { recursive: true });
  const shot = (name) =>
    page.screenshot({ path: 'test-results/v173-' + name + '.png', animations: 'disabled' });
  await page.goto(base);
  const quick = () => page.getByRole('textbox', { name: '快速记录正文' }).last();
  await quick().fill('崩溃恢复灵感 <不会执行>');
  await page.reload();
  await expect(quick()).toHaveValue('崩溃恢复灵感 <不会执行>');
  await shot('quick-recovered');
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await expect(quick()).toHaveValue('崩溃恢复灵感 <不会执行>');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '保存记录', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.ok(db.prepare("SELECT id FROM entries WHERE plain_text LIKE '%崩溃恢复灵感%'").get());
  await page.reload();
  await expect(quick()).toHaveValue('');
  const nav = (label) =>
    page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name: label, exact: true })
      .click();
  await nav('知识库');
  for (const title of ['阅读笔记', '网页资料', '实践工具']) {
    await page.getByRole('button', { name: '阅读内容 ' + title, exact: true }).click();
    await expect(page.getByRole('dialog', { name: '内容预览' })).toBeVisible();
    await expect(page.locator('.reading-surface')).toHaveCount(0);
    if (title === '网页资料')
      await expect(
        page.getByRole('dialog').getByRole('link', { name: '打开原网站 ↗' }),
      ).toHaveAttribute('href', 'https://example.com/research');
    await shot(
      'preview-' + (title === '阅读笔记' ? 'note' : title === '网页资料' ? 'web' : 'tool'),
    );
    await page.getByRole('button', { name: '完整阅读', exact: true }).click();
    await expect(page.locator('.reading-surface')).toBeVisible();
    await page.locator('.reading-main').evaluate((e) => (e.scrollTop = e.scrollHeight));
    const toolbar = page.locator('.reading-surface .reader-toolbar').first();
    assert.ok(
      await toolbar.evaluate(
        (e) =>
          e.getBoundingClientRect().top >= 68 && e.getBoundingClientRect().bottom < innerHeight,
      ),
    );
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).click();
    await page.getByRole('tab', { name: '来源与历史', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '阅读辅助信息' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.reader-aux')).toHaveCount(0);
    await toolbar.getByRole('button', { name: '← 返回列表', exact: true }).click();
  }
  await page.getByRole('button', { name: '阅读内容 综合研究文档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '内容预览' })).toHaveCount(0);
  const toolbar = () => page.locator('.knowledge-reader > .reader-toolbar');
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('.reading-main').evaluate((e) => (e.scrollTop = e.scrollHeight));
    assert.ok(
      await toolbar().evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom < innerHeight;
      }),
    );
    if (await page.getByRole('button', { name: '收起章节大纲', exact: true }).count())
      await page.getByRole('button', { name: '收起章节大纲', exact: true }).click();
    await page.getByRole('button', { name: '展开章节大纲', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '章节大纲' })).toBeVisible();
    await page
      .getByRole('navigation', { name: '章节大纲' })
      .getByRole('button', { name: /章节 3/ })
      .click();
    await expect(page.locator('#chapter-' + children[1].id + ' .prose')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('#chapter-' + children[1].id).evaluate((e) => {
          const r = e.getBoundingClientRect(),
            t = document.querySelector('.knowledge-reader>.reader-toolbar').getBoundingClientRect();
          return r.top >= t.bottom - 2 && r.top < innerHeight;
        }),
      )
      .toBe(true);
    await expect(page.locator('.reader-outline button[title="章节 3"]')).toHaveAttribute(
      'aria-current',
      'location',
    );
    await shot('reading-' + width);
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).click();
    for (const tab of ['来源与历史', '知识关联', '上下文 AI']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if ((await page.locator('.reader-aux').count()) === 0)
        await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.locator('.reader-aux')).toBeVisible();
    }
    if (width === 1920) {
      await expect(page.getByRole('navigation', { name: '章节大纲' })).toBeVisible();
      await page
        .getByRole('navigation', { name: '章节大纲' })
        .getByRole('button', { name: /章节 3/ })
        .click();
      await page.waitForTimeout(450);
    }
    await shot('document-' + width);
    assert.ok(
      await page.locator('.reader-aux').evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      }),
    );
    await page.getByRole('button', { name: '就此内容询问 AI', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.reader-aux')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.reader-aux')).toHaveCount(0);
    if (
      width <= 1000 &&
      (await page.getByRole('button', { name: '收起章节大纲', exact: true }).count())
    )
      await page.getByRole('button', { name: '收起章节大纲', exact: true }).click();
    await toolbar().getByRole('button', { name: '整理模式', exact: true }).click();
    await expect(page.locator('.chapter-controls')).toHaveCount(0);
    await page
      .getByRole('button', { name: /管理章节/ })
      .first()
      .click();
    await expect(page.locator('.chapter-controls')).toHaveCount(1);
    await shot('organize-' + width);
    await toolbar().getByRole('button', { name: '阅读模式', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await toolbar().getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('textbox', { name: '统一搜索' }).fill('阅读笔记');
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '阅读内容 阅读笔记', exact: true }).click();
  await page.route('**/api/entries/' + note.id, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page.goBack();
  await expect(page.locator('.reading-surface')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '内容预览' })).toBeVisible();
  await page.waitForTimeout(350);
  await expect(page.locator('.reading-surface')).toHaveCount(0);
  await page.unroute('**/api/entries/' + note.id);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page.locator('.reading-surface')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '统一搜索' })).toHaveValue('阅读笔记');

  await page.getByRole('button', { name: '阅读内容 阅读笔记', exact: true }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page
    .locator('.reading-surface .reader-toolbar')
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await expect(page.locator('.entry-form')).toBeVisible();
  await page
    .locator('.entry-form')
    .getByRole('textbox', { name: '标题', exact: true })
    .fill('尚未保存的编辑');
  page.once('dialog', (d) => d.dismiss());
  await page.goBack();
  await expect(page.locator('.entry-form')).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('#content-' + note.id);
  page.once('dialog', (d) => d.accept());
  await page.goBack();
  await expect(page.locator('.entry-form')).toHaveCount(0);
  assert.equal(db.prepare('SELECT title FROM entries WHERE id=?').get(note.id).title, '阅读笔记');
  await expect(page.getByRole('dialog', { name: '内容预览' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.evaluate((id) => sessionStorage.setItem('pk-last-read', id), doc.id);
  await nav('首页');
  await page.getByRole('button', { name: '综合研究文档 ↗', exact: true }).click();
  await expect(page.locator('.knowledge-reader')).toBeVisible();
  await toolbar().getByRole('button', { name: '← 返回列表', exact: true }).click();
  await expect(quick()).toBeVisible();
  await quick().fill('窗口A原稿');
  await expect(page.locator('.quick-record').getByRole('status')).toHaveText('临时草稿已保护');
  const other = await context.newPage();
  await other.goto(base);
  await expect(other.getByRole('textbox', { name: '快速记录正文' })).toHaveValue('窗口A原稿');
  await other.getByRole('textbox', { name: '快速记录正文' }).fill('窗口B独立输入');
  await expect(page.getByText(/另一窗口的临时输入已变化/)).toBeVisible();
  await quick().fill('窗口A保留输入');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(page.locator('.quick-record').getByRole('status')).toHaveText('临时草稿已保护');
  await other.reload();
  await expect(other.getByRole('textbox', { name: '快速记录正文' })).toHaveValue('窗口B独立输入');
  await expect(other.getByRole('button', { name: '保留当前输入', exact: true })).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await quick().fill('请求失败保留的输入');
  await expect(page.locator('.quick-record').getByRole('status')).toHaveText('临时草稿已保护');
  const count = db.prepare('SELECT count(*) n FROM entries').get().n;
  await page.route('**/api/capture', (r) =>
    r.fulfill({ status: 500, json: { error: '模拟保存失败' } }),
  );
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(quick()).toHaveValue('请求失败保留的输入');
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, count);
  await page.reload();
  await expect(quick()).toHaveValue('请求失败保留的输入');
  await page.unroute('**/api/capture');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(quick()).toHaveValue('');
  for (let i = 0; i < 30; i++)
    saveEntry(db, { ...form('分页样本 ' + i), content: '<p>仅用于分页与返回测试</p>' });
  await nav('知识库');
  if (await page.getByRole('button', { name: '重置全部筛选', exact: true }).count())
    await page.getByRole('button', { name: '重置全部筛选', exact: true }).click();

  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.library-results>.pagination')).toContainText('2 /');
  await page.evaluate(() => window.scrollTo(0, 500));
  const first = page.locator('.unified-card-main').first();
  await first.click();
  if (await page.getByRole('dialog', { name: '内容预览' }).count())
    await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await page
    .locator('.reading-surface')
    .getByRole('button', { name: '← 返回列表', exact: true })
    .click();
  await expect(page.locator('.library-results>.pagination')).toContainText('2 /');
  await nav('首页');
  await nav('知识库');
  await expect(page.locator('.library-results>.pagination')).toContainText('2 /');
  await page
    .getByRole('button', { name: '浏览领域 人物模拟与本地模型的研究实践长名称', exact: true })
    .click();
  await expect(page.locator('.library-results>.pagination')).toContainText('1 /');
  await expect(page.getByRole('textbox', { name: '统一搜索' })).toHaveValue('');
  await expect(page.getByRole('button', { name: '阅读内容 阅读笔记', exact: true })).toBeVisible();
  await shot('library');
  assert.deepEqual(errors, []);
  console.log(
    'PASS V1.7.3 Edge default preview/read, fixed toolbar, dual panels/outline/chapters, compact organize, refresh quick recovery, save clearing, history/list context, 1920/1366/390; no cloud calls',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
