import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { seedTopic, topicSuggestion } from './v13-fixture.js';
import {
  fixtureForm,
  fixtureKey,
  fixtureResponse,
  deepSeekFixtureKey,
  deepSeekFixtureResponse,
} from './ai-fixture.js';
const shareExample =
  '9.23 bnD:/ A@t.rR :0pm 11/24 现在这样玩还来得及吗 # 玩手机的正确打开方式 # 正确看手机姿势 https://v.douyin.com/6JyrttVf6y8/ 复制此链接，打开Dou音搜索，直接观看视频！';
const provider = process.argv.includes('--openai') ? 'openai' : 'deepseek';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-browser-v13-'));
let behavior = 'success',
  calls = 0;
const transport = async (_, options) => {
  calls++;
  if (behavior === 'wait')
    await new Promise((r, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  if (behavior === 'error') return new Response('test upstream error', { status: 500 });
  const body = JSON.parse(options.body),
    payload = JSON.parse(
      provider === 'openai' ? body.input[0].content[0].text : body.messages[1].content,
    );
  assert.equal(payload.sources.length, 3);
  assert.ok(!JSON.stringify(payload).includes('UNSELECTED_PRIVATE'));
  const value = topicSuggestion(payload);
  value.sections[0].paragraphs[0].text += ' <script>window.TOPIC_XSS=1</script>';
  return provider === 'openai' ? fixtureResponse(value) : deepSeekFixtureResponse(value);
};
const store = createApp(dir, {
  ai: {
    env: {
      PK_AI_PROVIDER: provider,
      ...(provider === 'openai'
        ? { OPENAI_API_KEY: fixtureKey }
        : { DEEPSEEK_API_KEY: deepSeekFixtureKey }),
      PK_AI_TIMEOUT_MS: '1000',
    },
    transport,
  },
});
const entries = seedTopic(store.getDb());
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
const get = async (url) => (await fetch(base + '/api' + url)).json();
let browser;
try {
  await fetch(base + '/api/drafts/' + entries[3].id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-PK-Request': '1' },
    body: JSON.stringify({
      form: { ...fixtureForm, title: '原个人笔记草稿', collections: [], domains: [] },
    }),
  });
  const workspace = readFileSync(path.join(dir, 'workspace.json'), 'utf8');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  const page = await context.newPage(),
    errors = [];
  const reload = async () => {
    const handler = (d) => d.accept();
    page.on('dialog', handler);
    try {
      await page.reload();
    } finally {
      page.off('dialog', handler);
    }
  };
  const closeSurface = async () => {
    const modal = page.getByRole('dialog').last();
    if (await modal.count()) await modal.getByRole('button', { name: '关闭', exact: true }).click();
    else await page.getByRole('button', { name: '← 返回列表', exact: true }).last().click();
  };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const openTopic = async () => {
    await page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name: '知识库', exact: true })
      .click();
    await page.getByRole('button', { name: '专题筛选', exact: true }).click();
    await page
      .getByRole('group', { name: '专题可选值' })
      .getByRole('button', { name: '前端实践专题', exact: true })
      .click();
    await page.getByRole('button', { name: '打开专题总结', exact: true }).click();
  };
  await openTopic();
  await expect(page.getByRole('heading', { name: '前端实践专题', exact: true })).toBeVisible();
  await expect(page.locator('.collection-resources .card')).toHaveCount(4);
  await page.getByRole('button', { name: '编辑总结', exact: true }).click();
  await page
    .getByRole('textbox', { name: '专题介绍', exact: true })
    .fill('把参考资源转化为自己的理解。');
  await page.locator('.tiptap').fill('原始专题判断：先关注阅读路径，再选择布局方案。');
  await page.locator('.tiptap').press('Control+a');
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  const png = await sharp({
    create: { width: 160, height: 100, channels: 3, background: '#8cb9a1' },
  })
    .png()
    .toBuffer();
  await page.locator('.tiptap').press('Control+End');
  await page
    .getByLabel('插入正文图片', { exact: true })
    .setInputFiles({ name: 'topic.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.tiptap img')).toHaveCount(1);
  await page.getByRole('button', { name: '保存专题', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑总结', exact: true })).toBeVisible();
  const original = await get('/collections/topic');
  assert.ok(original.content.includes('<h2>'));
  assert.ok(original.content.includes('/assets/'));
  mkdirSync('test-results', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/v1.3-' + provider + '-topic.png', fullPage: true });
  // Independent manual topic draft survives a reload without changing old workspace.
  await page.getByRole('button', { name: '编辑总结', exact: true }).click();
  await page.locator('.tiptap').press('Control+End');
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').pressSequentially('未保存的专题补充');
  await page.getByText('专题草稿已保存在本机', { exact: true }).waitFor();
  assert.equal(readFileSync(path.join(dir, 'workspace.json'), 'utf8'), workspace);
  await reload();
  await openTopic();
  await page.getByRole('button', { name: '恢复专题草稿', exact: true }).click();
  await expect(page.locator('.tiptap')).toContainText('未保存的专题补充');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '放弃专题草稿', exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '放弃专题草稿', exact: true }).click();
  assert.equal((await get('/collections/topic')).content, original.content);
  // Relation removal preserves the original record and its other topic.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '从专题移除 ' + entries[3].title, exact: true }).click();
  await expect(page.locator('.collection-resources .card')).toHaveCount(3);
  assert.equal((await get('/entries/' + entries[3].id)).collections.length, 1);
  await page.getByRole('button', { name: '添加已有资源', exact: true }).click();
  await page.getByRole('checkbox', { name: '添加资源 ' + entries[3].title, exact: true }).check();
  await page.getByRole('button', { name: '添加所选资源 (1)', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.collection-resources .card')).toHaveCount(4);
  for (const entry of entries.slice(0, 3))
    await page.getByRole('checkbox', { name: '综合整理选择 ' + entry.title, exact: true }).check();
  await page.getByRole('button', { name: /综合整理所选/ }).click();
  await expect(page.getByLabel('专题 AI 草稿审核')).toBeVisible();
  assert.equal((await get('/collections/topic')).content, original.content);
  await page
    .getByRole('textbox', { name: '专题 AI 推荐标题', exact: true })
    .fill('人工审核后的专题理解');
  await page.getByRole('textbox', { name: '专题 AI 整理稿', exact: true }).press('Control+End');
  await page
    .getByRole('textbox', { name: '专题 AI 整理稿', exact: true })
    .pressSequentially('\n\n人工补充的待验证事项。');
  await expect
    .poll(async () => (await get('/collections/topic/drafts/ai'))?.reviewTitle)
    .toBe('人工审核后的专题理解');
  await page.getByLabel('专题 AI 草稿审核').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('textarea').forEach((t) => (t.scrollTop = 0));
  });
  await page.screenshot({
    path: 'test-results/v1.3-' + provider + '-ai-review.png',
    fullPage: true,
  });
  await reload();
  await openTopic();
  await expect(page.getByRole('textbox', { name: '专题 AI 推荐标题', exact: true })).toHaveValue(
    '人工审核后的专题理解',
  );
  await expect(page.getByRole('textbox', { name: '专题 AI 整理稿', exact: true })).toContainText(
    '人工补充的待验证事项。',
  );
  await page.getByRole('button', { name: '追加到原总结', exact: true }).click();
  await expect(page.locator('.tiptap a[data-entry-id]')).not.toHaveCount(0);
  await expect(page.locator('.tiptap img')).toHaveCount(1);
  assert.equal((await get('/collections/topic')).content, original.content);
  await page.getByRole('button', { name: '保存专题', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑总结', exact: true })).toBeVisible();
  const appended = await get('/collections/topic');
  assert.ok(appended.content.startsWith(original.content));
  assert.ok(appended.content.includes('data-entry-id'));
  assert.ok(appended.content.includes('&lt;script&gt;'));
  assert.equal(await page.evaluate(() => window.TOPIC_XSS), undefined);
  await page.locator('.collection-prose a[data-entry-id]').first().click();
  await expect(page.getByRole('region', { name: '内容阅读', exact: true })).toBeVisible();
  await closeSurface();
  await page.getByRole('button', { name: '编辑总结', exact: true }).click();
  await page.locator('.tiptap').press('Control+End');
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').pressSequentially('后续手工修改保留来源引用');
  await page.getByRole('button', { name: '保存专题', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑总结', exact: true })).toBeVisible();
  assert.ok((await get('/collections/topic')).content.includes('data-entry-id'));
  await page.getByRole('button', { name: '历史版本', exact: true }).click();
  await page.getByRole('button', { name: /^版本 1 ·/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此专题版本', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await get('/collections/topic')).content).toBe(original.content);
  for (const entry of entries.slice(0, 3))
    await page.getByRole('checkbox', { name: '综合整理选择 ' + entry.title, exact: true }).check();
  await page.getByRole('button', { name: /综合整理所选/ }).click();
  await expect(page.getByLabel('专题 AI 草稿审核')).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '替换原总结', exact: true }).click();
  assert.equal((await get('/collections/topic')).content, original.content);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '替换原总结', exact: true }).click();
  await page.getByRole('button', { name: '保存专题', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑总结', exact: true })).toBeVisible();
  assert.ok(!(await get('/collections/topic')).content.startsWith(original.content));
  behavior = 'error';
  await page.getByRole('button', { name: /综合整理所选/ }).click();
  await expect(page.locator('.collection-page [role=alert]')).toContainText('AI 服务返回错误');
  behavior = 'wait';
  await page.getByRole('button', { name: /综合整理所选/ }).click();
  await page.getByRole('button', { name: '取消专题 AI 请求', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑总结', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /综合整理所选/ }).click();
  await expect(page.locator('.collection-page [role=alert]')).toContainText('超时');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({
    path: 'test-results/v1.3-' + provider + '-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: 'test-results/v1.3-' + provider + '-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(readFileSync(path.join(dir, 'workspace.json'), 'utf8'), workspace);
  // Clipboard event is dispatched inside the real browser; no system clipboard or source network is used.
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: '网站收藏', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('已填写的手工标题');
  await page.locator('.tiptap').fill('手工笔记不能被分享文字覆盖。');
  const beforeCalls = calls;
  await page.getByRole('textbox', { name: '网址', exact: true }).evaluate((el, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  }, shareExample);
  await expect(page.getByRole('textbox', { name: '分享候选标题', exact: true })).toHaveValue(
    '现在这样玩还来得及吗',
  );
  await page.getByRole('button', { name: '拒绝分享候选', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '原始分享文字', exact: true })).toHaveValue(
    shareExample,
  );
  await page.getByRole('button', { name: '解析分享文字', exact: true }).click();
  await page.getByRole('checkbox', { name: '分享话题 玩手机的正确打开方式', exact: true }).check();
  await page.getByLabel('分享文字解析', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v1.3-share-candidates.png' });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '采用分享候选', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '网址', exact: true })).toHaveValue(
    'https://v.douyin.com/6JyrttVf6y8/',
  );
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    '已填写的手工标题',
  );
  await expect(page.locator('.tiptap')).toHaveText('手工笔记不能被分享文字覆盖。');
  assert.equal(calls, beforeCalls);
  await page.getByLabel('分享文字解析', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v1.3-share-text.png' });
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('link', { name: '已填写的手工标题', exact: true })).toBeVisible();
  const saved = (await get('/entries?q=' + encodeURIComponent('已填写的手工标题'))).items[0];
  assert.equal(saved.tags.length, 1);
  assert.ok(saved.content.includes('手工笔记不能被分享文字覆盖'));
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: '网站收藏', exact: true }).click();
  await page
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://v.douyin.com/6JyrttVf6y8/');
  await expect(page.getByText('这个网址已经收藏过', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await closeSurface();
  assert.deepEqual(errors, []);
  console.log(
    'PASS V1.3 ' +
      provider +
      ': topic rich summary/images/drafts, associations, AI review persistence, append/replace/history/source links, error/cancel/timeout, original workspace, mobile/dark, local share parse/reject/adopt, no overwritten title/note, duplicate; no page errors.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
