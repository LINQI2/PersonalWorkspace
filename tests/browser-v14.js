import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { fixtureForm } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v14-edge-'));
const store = createApp(dir, {
  ai: {
    env: {},
    transport: () => {
      throw Error('unexpected cloud request');
    },
  },
});
const db = store.getDb();
for (const [k, names] of [
  ['domains', ['开发效率', '设计创作', '日常实用']],
  ['tags', ['免费', '常用']],
  ['collections', ['工作工具箱']],
])
  for (const [i, name] of names.entries())
    db.prepare(`INSERT INTO ${k} VALUES(?,?)`).run(k + i, name);
const examples = [
  ['代码编辑器', 'desktop', '轻量代码编辑，适合日常开发。'],
  ['配色助手', 'online', '比较配色与对比度，整理设计方案。'],
  ['文本模型服务', 'ai', '按需整理文字，使用前核对成本。'],
  ['文档导航', 'website', '把常用技术文档放在手边。'],
  ['自己的脚本', 'custom', '记录脚本用途，不从网站直接执行。'],
  ['格式转换参考', 'other', '备忘与操作步骤，随时回来查阅。'],
];
for (let i = 0; i < 14; i++) {
  const [title, kind, description] = examples[i % examples.length];
  saveEntry(db, {
    ...fixtureForm,
    type: 'note',
    resource_kind: 'tool',
    tool_kind: kind,
    title: title + (i >= 6 ? ' · ' + (i + 1) : ''),
    url: kind === 'desktop' || kind === 'custom' ? '' : 'https://example.com/tools/' + i,
    description,
    content:
      '<h2>使用经验</h2><p>先用小样本验证效果，重要结果仍需人工核对。</p><ul><li>优点：操作简洁。</li><li>注意：数据与成本需要核对。</li></ul>',
    domains: ['domains' + (i % 3)],
    tags: ['tags' + (i % 2)],
    collections: ['collections0'],
  });
}
saveEntry(db, { ...fixtureForm, title: '普通收藏仍正常', url: 'https://example.com/knowledge' });
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
  await page.getByRole('button', { name: /^工作工具箱/ }).click();
  await page.getByRole('button', { name: '编辑总结', exact: true }).click();
  await page.locator('.tiptap').fill('未保存专题正文仍需保护');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: /工具库/ }).click();
  await expect(page.locator('.tiptap')).toContainText('未保存专题正文仍需保护');
  await expect(page.locator('.breadcrumb')).toContainText('工作工具箱');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.getByRole('button', { name: /工具库/ }).click();
  await expect(page.locator('.tools-grid .tool-card')).toHaveCount(14);
  assert.ok(
    (await page
      .locator('.tool-card')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height)) < 270,
  );
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/v1.4-tools-desktop.png', animations: 'disabled' });
  await page.getByRole('combobox', { name: '工具类型筛选' }).selectOption('desktop');
  await expect(page.locator('.tool-card')).toHaveCount(3);
  await page.getByRole('combobox', { name: '工具类型筛选' }).selectOption('');
  await page.getByRole('button', { name: '全部领域', exact: true }).click();
  await page.getByRole('button', { name: '添加工具', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加工具', exact: true });
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('无网址测试工具');
  await editor.getByRole('combobox', { name: '工具类型', exact: true }).selectOption('custom');
  await editor.getByRole('textbox', { name: '简介', exact: true }).fill('个人工具用途描述');
  await editor.locator('.tiptap').fill('使用经验可全站搜索specialtooltext');
  const icon = await sharp({
    create: { width: 50, height: 50, channels: 4, background: '#26786b' },
  })
    .png()
    .toBuffer();
  await editor
    .getByLabel('上传封面', { exact: true })
    .setInputFiles({ name: 'synthetic-icon.png', mimeType: 'image/png', buffer: icon });
  await expect(editor.locator('.cover-upload img')).toBeVisible();
  for (const name of ['开发效率', '免费', '工作工具箱'])
    await editor.getByRole('button', { name: new RegExp('^' + name) }).click();
  await editor.getByRole('button', { name: '保存条目', exact: true }).click();
  const card = page
    .locator('.tool-card')
    .filter({ has: page.getByRole('heading', { name: '无网址测试工具', exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator('.tool-icon img')).toBeVisible();
  await expect(card.getByRole('link', { name: /打开原网站/ })).toHaveCount(0);
  await card.locator('summary').click();
  await expect(card.getByText(/specialtooltext/)).toBeVisible();
  await card.getByRole('button', { name: '编辑 无网址测试工具', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑工具', exact: true });
  await expect(edit.getByRole('combobox', { name: '工具类型', exact: true })).toHaveValue('custom');
  await edit
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://example.com/new-tool');
  await edit.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(card.getByRole('link', { name: /打开原网站/ })).toHaveAttribute(
    'href',
    'https://example.com/new-tool',
  );
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page.locator('.tools-grid')).toHaveClass(/list-view/);
  await page.getByRole('button', { name: '网格视图', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /工具库/ }).click();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: /^全部收藏/ }).click();
  await page.getByRole('textbox', { name: '搜索收藏', exact: true }).fill('specialtooltext');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: '查看 无网址测试工具', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '收藏详情' }).getByText('工作工具箱', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除条目', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  // Closing a scrolled AI section cannot affect the next taxonomy entry position.
  await page.getByRole('button', { name: /^AI ·/ }).click();
  let activeSettings = page.getByRole('dialog', { name: '分类与备份设置', exact: true });
  await activeSettings.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await activeSettings.getByRole('button', { name: '关闭', exact: true }).click();
  // Each shortcut starts at its own visible form.
  for (const [shortcut, label] of [
    ['管理领域', '领域'],
    ['管理标签', '标签'],
    ['管理专题', '专题收藏夹'],
  ]) {
    await page.getByRole('button', { name: shortcut, exact: true }).click();
    const settings = page.getByRole('dialog', { name: '分类与备份设置', exact: true });
    await expect(settings.getByRole('tab', { name: '分类管理', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(settings.getByRole('textbox', { name: '分类名称', exact: true })).toHaveAttribute(
      'placeholder',
      '新的' + label + '名称',
    );
    await expect(settings.getByRole('textbox', { name: '分类名称', exact: true })).toBeFocused();
    await expect(settings.getByRole('textbox', { name: '新 API Key', exact: true })).toBeHidden();
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('button', { name: /^AI ·/ }).click();
  activeSettings = page.getByRole('dialog', { name: '分类与备份设置', exact: true });
  await activeSettings
    .getByRole('textbox', { name: '新 API Key', exact: true })
    .fill('sk-test-only-v14-unsaved');
  await activeSettings.getByRole('tab', { name: '分类管理', exact: true }).click();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement.closest('[hidden]') === null),
      true,
    );
  }
  page.once('dialog', (d) => d.dismiss());
  await activeSettings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(activeSettings).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await activeSettings.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /^AI ·/ }).click();
  await expect(page.getByRole('textbox', { name: '新 API Key', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /工具库/ }).click();
  await expect(page.locator('.tools-grid .tool-card')).toHaveCount(14);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/v1.4-tools-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/v1.4-tools-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '分类与备份设置', exact: true });
  await settings.getByRole('tab', { name: 'AI 配置', exact: true }).click();
  await expect(settings.getByLabel('AI 安全配置', { exact: true })).toBeVisible();
  await settings.getByRole('tab', { name: '备份与草稿', exact: true }).click();
  await expect(settings.getByRole('button', { name: '导出完整备份', exact: true })).toBeVisible();
  await settings.getByRole('tab', { name: '网站启停', exact: true }).click();
  await expect(settings.getByRole('button', { name: '正常停止网站', exact: true })).toBeVisible();
  await settings.getByRole('tab', { name: '分类管理', exact: true }).click();
  await settings.getByRole('button', { name: '标签', exact: true }).click();
  await settings.getByRole('textbox', { name: '分类名称', exact: true }).fill('窄屏创建测试');
  await settings.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    settings.getByRole('button', { name: '改名 窄屏创建测试', exact: true }),
  ).toBeVisible();
  assert.ok(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: 'test-results/v1.4-settings-mobile.png', animations: 'disabled' });
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(settings).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS actual Edge V1.4: compact tool CRUD/optional URL/icon/notes/type/search/topic, reload/list/dark/mobile; all settings shortcuts/sections/focus/narrow creation; zero page errors or cloud calls.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
