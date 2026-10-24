import { chromium, expect } from '@playwright/test';
import { createApp } from '../app/server/index.js';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const directory = mkdtempSync(path.join(os.tmpdir(), 'pk-browser-'));
const store = createApp(directory);
const server = store.app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  const channels = ['msedge', 'chrome', undefined];
  let last;
  for (const channel of channels) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch (e) {
      last = e;
    }
  }
  if (!browser) throw new Error('没有可用的 Chromium 浏览器：' + last.message);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('heading', { name: '从第一条收藏开始' }).waitFor();
  await page.getByRole('button', { name: '分类与备份设置' }).click();
  for (const [kind, names] of [
    ['领域', ['产品设计', '前端开发']],
    ['标签', ['灵感', '待读']],
    ['专题收藏夹', ['网站重构', '周末阅读']],
  ]) {
    await page.getByRole('button', { name: kind, exact: true }).click();
    for (const name of names) {
      await page.getByRole('textbox', { name: '分类名称' }).fill(name);
      await page.getByRole('button', { name: '创建', exact: true }).click();
      await page.getByRole('button', { name: '改名 ' + name }).waitFor();
    }
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://www.zhihu.com/question/123');
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('构建自己的知识空间');
  await page
    .getByRole('textbox', { name: '简介', exact: true })
    .fill('把阅读与思考连接起来，留住有价值的灵感。');
  for (const name of ['产品设计', '前端开发', '灵感', '待读', '网站重构', '周末阅读'])
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  const image = await sharp({
    create: { width: 600, height: 360, channels: 3, background: '#b5c4db' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('上传封面')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
  await page.getByAltText('封面预览').waitFor();
  await page.locator('[contenteditable=true]').fill('笔记正文检索词：让收藏真正成为自己的知识。');
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  await page
    .getByLabel('插入正文图片')
    .setInputFiles({ name: 'body.png', mimeType: 'image/png', buffer: image });
  await page.locator('.tiptap img').waitFor();
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).click();
  assert.equal(await page.locator('.detail-prose h2').count(), 1);
  assert.equal(await page.locator('.detail-prose img').count(), 1);
  assert.equal(
    await page.getByRole('link', { name: '打开原网站', exact: true }).getAttribute('rel'),
    'noopener noreferrer',
  );
  await page.context().route('https://www.zhihu.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><title>External link test</title></html>',
    }),
  );
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '打开原网站', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://www.zhihu.com/question/123');
  await popup.close();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索收藏' }).fill('笔记正文检索词');
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  await page.getByRole('textbox', { name: '搜索收藏' }).fill('没有匹配的搜索');
  await page.getByRole('heading', { name: '还没有找到相关收藏' }).waitFor();
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  await page.getByRole('button', { name: '编辑 构建自己的知识空间' }).click();
  await page.getByRole('textbox', { name: '简介', exact: true }).fill('编辑后的简介');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await page.getByText('编辑后的简介', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://www.zhihu.com/question/123');
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('重复收藏测试');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await page.getByRole('button', { name: '仍然保存重复网址' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page.getByRole('button', { name: '放弃旧草稿', exact: true }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '放弃旧草稿', exact: true }).click();
  await page.getByRole('button', { name: '原创笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('关于长期学习的思考');
  await page.locator('[contenteditable=true]').fill('持续记录，持续理解。');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await page.getByRole('button', { name: '查看 关于长期学习的思考' }).waitFor();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '未归属领域', exact: true }).click();
  await expect(page.getByRole('button', { name: '阅读内容 关于长期学习的思考' })).toBeVisible();
  await expect(page.locator('.unified-card')).toHaveCount(1);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
  await page.getByRole('button', { name: '查看 关于长期学习的思考' }).click();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '删除条目' }).click();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '分类与备份设置' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('tab', { name: '备份与草稿', exact: true }).click();
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const download = await downloadPromise;
  const backupPath = path.join(directory, 'ui-backup.zip');
  await download.saveAs(backupPath);
  assert.ok(existsSync(backupPath));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '查看 关于长期学习的思考' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除条目' }).click();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  await page.getByRole('button', { name: '分类与备份设置' }).click();
  await page.getByRole('tab', { name: '备份与草稿', exact: true }).click();
  await page.getByLabel('导入备份').setInputFiles(backupPath);
  await page.getByText(/已校验：2 条收藏/).waitFor();
  await page.getByRole('textbox', { name: '恢复确认文字' }).fill('恢复当前知识库');
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByText(/恢复成功；安全备份/).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '查看 关于长期学习的思考' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).waitFor();
  await page.getByRole('button', { name: '查看 构建自己的知识空间' }).click();
  assert.equal(await page.locator('.detail-prose img').count(), 1);
  assert.equal(
    await page.locator('.detail-prose img').evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real Chromium UI create, rich text, cover/body upload, search, edit, duplicate warning, pending, cancel/delete, export and restore, reload and mobile layout.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
