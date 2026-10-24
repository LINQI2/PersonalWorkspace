import { chromium } from '@playwright/test';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const phase = process.argv[2] || 'after';
if (phase !== 'after' || JSON.parse(readFileSync('package.json', 'utf8')).version !== '1.5.0')
  throw new Error('本脚本仅生成当前 V1.5-A after 截图，禁止混用旧版本基线。');
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-visual-'));
const store = createApp(dir),
  db = store.getDb();
for (const [i, name] of ['产品设计', '前端开发', '学习方法', '视觉灵感', '生活方式'].entries())
  db.prepare('INSERT INTO domains VALUES(?,?)').run('domain-' + i, name);
for (const [i, name] of ['精选', '待读', '实践'].entries())
  db.prepare('INSERT INTO tags VALUES(?,?)').run('tag-' + i, name);
db.prepare('INSERT INTO collections VALUES(?,?)').run('collection-0', '个人网站设计');
const entries = [
  ['让界面回归内容：信息层级与留白', '产品设计', '从阅读路径出发，理解清晰界面的设计原则。'],
  ['CSS 布局中的网格与弹性', '前端开发', '整理常用布局方法，记录真实项目中的取舍。'],
  ['关于长期学习的几点思考', '学习方法', '把阅读转化为理解，给持续积累一个可靠的位置。'],
  ['配色、字体与细节的平衡', '视觉灵感', '值得反复回看的视觉参考与自己的观察。'],
  ['构建一个可持续的知识习惯', '学习方法', '少一点收集焦虑，多一点消化与连接。'],
  ['留给生活的小小灵感', '生活方式', '记录日常发现，在需要的时候重新遇见。'],
];
const names = ['产品设计', '前端开发', '学习方法', '视觉灵感', '生活方式'];
let first;
for (const [i, [title, domain, description]] of entries.entries()) {
  const e = saveEntry(db, {
    type: i === 2 ? 'note' : 'bookmark',
    title,
    url: i === 2 ? '' : 'https://example.com/reference/' + i,
    description,
    content:
      '<h2>为什么值得留下</h2><p>一条收藏的价值，在于它和自己的问题产生联系。</p><h3>我的理解</h3><p>留白让信息更容易被阅读，清晰的层级让操作更有把握。</p><ul><li>先记录问题，再整理参考。</li><li>每次回看，补充一点新的理解。</li></ul>' +
      Array(8).fill('<p>持续思考与实践，把零散的信息连接为自己的知识。</p>').join(''),
    domains: ['domain-' + names.indexOf(domain)],
    tags: ['tag-' + (i % 3)],
    collections: i % 2 === 0 ? ['collection-0'] : [],
    pinned: i === 0 ? 1 : 0,
  });
  if (i === 0) first = e;
}
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('.card').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  console.log(
    'Page dimensions:',
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    })),
  );
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({
    path: `test-results/v1.3-${phase}-home.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '查看 ' + first.title }).click();
  await page.screenshot({
    path: `test-results/v1.3-${phase}-detail.png`,
    fullPage: false,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏', exact: true }).click();
  await page.screenshot({
    path: `test-results/v1.3-${phase}-editor.png`,
    fullPage: false,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  if (phase === 'after') {
    await page.getByRole('button', { name: '列表视图' }).click();
    await page.screenshot({ path: 'test-results/v1.5-after-list.png', fullPage: true });
    await page.getByRole('button', { name: '网格视图' }).click();
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.screenshot({
      path: 'test-results/v1.5-after-dark.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'test-results/v1.5-after-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
  }
  console.log('Visual screenshots: ' + phase + ' (synthetic fixture data only).');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
