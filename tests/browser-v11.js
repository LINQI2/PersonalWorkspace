import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-ui-v11-'));
const store = createApp(dir),
  db = store.getDb();
for (const [id, name] of [
  ['design', '设计'],
  ['code', '开发'],
])
  db.prepare('INSERT INTO domains VALUES(?,?)').run(id, name);
db.prepare('INSERT INTO tags VALUES(?,?)').run('read', '待读');
db.prepare('INSERT INTO collections VALUES(?,?)').run('weekend', '周末精选');
const original = saveEntry(db, {
  type: 'bookmark',
  title: '已有收藏',
  url: 'https://example.com/reference',
  description: '原始简介',
  content: '<h2>原始正文</h2><p>原始语义</p>',
  domains: ['design'],
  tags: ['read'],
  collections: ['weekend'],
  cover_asset_id: null,
  pinned: 0,
});
const other = saveEntry(db, {
  type: 'note',
  title: '待整理笔记',
  description: '',
  content: '<p>不被批量整理覆盖。</p>',
  domains: [],
  tags: [],
  collections: [],
  cover_asset_id: null,
  pinned: 0,
});
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: '查看 已有收藏' }).waitFor();
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.list-view')).toHaveCount(1);
  await page.getByRole('combobox', { name: '排序' }).selectOption('title');
  await page.reload();
  await expect(page.locator('.list-view')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('title');
  await page.getByRole('combobox', { name: '专题筛选' }).selectOption('weekend');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: '置顶 已有收藏' }).click();
  await page.getByRole('button', { name: '取消置顶 已有收藏' }).waitFor();
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await page.getByRole('checkbox', { name: '全选当前页' }).check();
  await page.getByRole('button', { name: '添加分类 / 标签' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '开发', exact: true }).click();
  await page.getByRole('button', { name: '应用到所选条目' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '完成管理' }).click();
  assert.equal(
    (await (await fetch(base + '/api/entries/' + original.id)).json()).content,
    original.content,
  );
  assert.equal(
    (await (await fetch(base + '/api/entries/' + other.id)).json()).content,
    other.content,
  );
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '网址', exact: true })).toBeFocused();
  await page
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://example.com/reference#part');
  await page.getByRole('button', { name: '查看已有收藏', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('保留为草稿');
  await page.getByRole('button', { name: '查看已有收藏', exact: true }).click();
  await page.getByRole('dialog').getByRole('heading', { name: '已有收藏', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('保留为草稿');
  await page.getByRole('button', { name: '原创笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('可恢复的原创笔记');
  await page.getByRole('button', { name: '+ 新建标签', exact: true }).click();
  await page.getByRole('textbox', { name: '新建标签名称' }).fill('实践记录');
  await page.getByRole('button', { name: '创建并选中' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '实践记录', exact: true }).waitFor();
  const editor = page.locator('[contenteditable=true]');
  await editor.fill('格式与链接保留');
  await editor.press('Control+a');
  await expect
    .poll(() => editor.evaluate(() => window.getSelection()?.toString()))
    .toBe('格式与链接保留');
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  await expect(page.locator('.tiptap h2')).toHaveText('格式与链接保留');
  await page.locator('.tiptap h2').click();
  await expect(page.getByRole('button', { name: 'H2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await editor.press('Control+a');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(page.locator('.tiptap h2 strong')).toHaveText('格式与链接保留');
  await page.locator('.tiptap h2 strong').click();
  await expect(page.getByRole('button', { name: '加粗', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await editor.press('Control+a');
  await page.getByRole('button', { name: '链接', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记链接地址' }).fill('https://example.com/reading');
  await page.getByRole('button', { name: '应用链接' }).click();
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', 'https://example.com/reading');
  await editor.press('Control+End');
  await expect.poll(() => editor.evaluate((el) => el.editor.state.selection.empty)).toBe(true);
  await page.getByRole('button', { name: '链接', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记链接地址' }).fill('https://example.com/inserted');
  await page.getByRole('button', { name: '应用链接' }).click();
  await expect(page.locator('.tiptap a[href="https://example.com/inserted"]')).toHaveText(
    'https://example.com/inserted',
  );
  await page.getByText('草稿已保存在本机', { exact: true }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    '可恢复的原创笔记',
  );
  await expect(page.locator('.tiptap h2 strong')).toHaveText('格式与链接保留');
  await expect(page.locator('.tiptap a[href="https://example.com/reading"]')).toHaveText(
    '格式与链接保留',
  );
  await expect(page.locator('.tiptap a[href="https://example.com/inserted"]')).toHaveCount(1);
  const recoveredDraft = (await (await fetch(base + '/api/drafts/new')).json()).form;
  await page.getByRole('dialog').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await page.getByRole('button', { name: '查看 可恢复的原创笔记' }).waitFor();
  assert.equal(await (await fetch(base + '/api/drafts/new')).json(), null);
  await fetch(base + '/api/drafts/new', {
    method: 'PUT',
    headers: { 'X-PK-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ form: { ...recoveredDraft, title: '草稿清理验证' } }),
  });
  await page.getByRole('button', { name: '分类与备份设置', exact: true }).click();
  await page.getByRole('tab', { name: '备份与草稿', exact: true }).click();
  const discard = page.getByRole('button', { name: '丢弃草稿 草稿清理验证', exact: true });
  await discard.waitFor();
  page.once('dialog', (d) => d.dismiss());
  await discard.click();
  await expect(discard).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await discard.click();
  await expect(discard).toHaveCount(0);
  assert.equal(await (await fetch(base + '/api/drafts/new')).json(), null);
  assert.equal((await (await fetch(base + '/api/entries')).json()).total, 3);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  assert.ok(
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '设计', exact: true })
      .locator('small')
      .count(),
  );
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 可恢复的原创笔记' }).check();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(3);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: '完成管理' }).click();
  await page.getByRole('button', { name: '网格视图' }).click();
  await expect(page.locator('.list-view')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.list-view')).toHaveCount(1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS V1.1 UI: persistent grid/list/sort, topic filters, direct pin, batch add/cancel/delete, existing duplicate detail, inline taxonomy, recent choices, editor states/links and draft restore after reload.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
