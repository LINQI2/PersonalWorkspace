import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import {
  fixtureKey,
  fixtureForm,
  fixtureSuggestion,
  fixtureResponse,
  deepSeekFixtureKey,
  deepSeekFixtureResponse,
} from './ai-fixture.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-browser-ai-'));
const provider = process.argv.includes('--deepseek') ? 'deepseek' : 'openai';
let behavior = 'success',
  calls = 0;
const transport = async (_, options) => {
  calls++;
  if (behavior === 'wait') {
    await new Promise((resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  }
  if (behavior === 'error') return new Response('private error', { status: 500 });
  const body = JSON.parse(options.body);
  const payload = JSON.parse(
    provider === 'deepseek' ? body.messages[1].content : body.input[0].content[0].text,
  );
  const value = fixtureSuggestion(payload);
  if (payload.mode === 'note')
    value.sections[0].paragraphs.push(
      '<img src=x onerror=window.AI_XSS=1><script>window.AI_XSS=1</script>',
    );
  return provider === 'deepseek' ? deepSeekFixtureResponse(value) : fixtureResponse(value);
};
const store = createApp(dir, {
  ai: {
    env: {
      PK_AI_PROVIDER: provider,
      ...(provider === 'deepseek'
        ? { DEEPSEEK_API_KEY: deepSeekFixtureKey }
        : { OPENAI_API_KEY: fixtureKey }),
      PK_AI_TIMEOUT_MS: '1000',
    },
    transport,
  },
});
for (const [kind, name] of [
  ['domains', '前端开发'],
  ['tags', '实践'],
  ['collections', '界面设计'],
])
  store
    .getDb()
    .prepare(`INSERT INTO ${kind} VALUES(?,?)`)
    .run(kind + '-id', name);
const original = saveEntry(store.getDb(), fixtureForm);
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
const get = async (url) => (await fetch(base + '/api' + url)).json();
let browser, noKeyStore, noKeyServer;
const noKeyDir = mkdtempSync(path.join(os.tmpdir(), 'pk-browser-no-key-'));
try {
  const image = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#76b298' },
  })
    .png()
    .toBuffer();
  const upload = new FormData();
  upload.append('image', new Blob([image], { type: 'image/png' }), 'synthetic.png');
  const asset = await (
    await fetch(base + '/api/assets', {
      method: 'POST',
      headers: { 'X-PK-Request': '1' },
      body: upload,
    })
  ).json();
  const note = saveEntry(store.getDb(), {
    ...fixtureForm,
    type: 'note',
    title: '保留事实的原创笔记',
    url: '',
    content:
      fixtureForm.content +
      `<p><a href="https://example.com/reference">原有链接</a></p><img src="${asset.url}" />`,
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const closeSurface = async () => {
    const modal = page.getByRole('dialog').last();
    if (await modal.count()) await modal.getByRole('button', { name: '关闭', exact: true }).click();
    else await page.getByRole('button', { name: '← 返回列表', exact: true }).last().click();
  };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  assert.equal((await get('/ai/status')).provider, provider);
  await page
    .locator('.task-row')
    .filter({ has: page.getByRole('link', { name: original.title, exact: true }) })
    .locator('.action-menu>summary')
    .click();
  await page.getByRole('button', { name: '编辑 / 移动归属', exact: true }).click();
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  const review = page.getByLabel('AI 建议审核');
  await expect(review).toBeVisible();
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    original.title,
  );
  await expect(page.getByRole('checkbox', { name: 'AI 领域 前端开发', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'AI 标签 实践', exact: true })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'AI 专题收藏夹 界面设计', exact: true }),
  ).toBeChecked();
  assert.deepEqual(await get('/entries/' + original.id), original);
  mkdirSync('test-results', { recursive: true });
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v1.2-' + provider + '-bookmark-review.png' });
  // Reject leaves the original form and stored record untouched.
  await page.getByRole('button', { name: '取消 / 拒绝', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    original.title,
  );
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(review).toBeVisible();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('生成后新增的人工输入');
  await expect(page.getByRole('button', { name: '采用所选建议', exact: true })).toBeDisabled();
  await expect(review).toContainText('编辑内容已变化');
  await page.getByRole('button', { name: '取消 / 拒绝', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill(original.title);
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(review).toBeVisible();
  await page.getByRole('textbox', { name: 'AI 推荐标题', exact: true }).fill('人工审核后的标题');
  await page.getByRole('textbox', { name: 'AI 摘要', exact: true }).fill('人工修订后的简短摘要');
  await page.getByRole('checkbox', { name: '采用摘要', exact: true }).uncheck();
  await page.getByRole('textbox', { name: 'AI 候选新标签 1', exact: true }).fill('人工确认标签');
  await page.getByRole('checkbox', { name: 'AI 新标签 人工确认标签', exact: true }).check();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '采用所选建议', exact: true }).click();
  assert.equal((await get('/meta')).tags.length, 1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '采用所选建议', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    '人工审核后的标题',
  );
  await expect(page.getByRole('textbox', { name: '简介', exact: true })).toHaveValue(
    original.description,
  );
  assert.deepEqual(await get('/entries/' + original.id), original);
  assert.ok((await get('/meta')).tags.some((t) => t.name === '人工确认标签'));
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const accepted = await get('/entries/' + original.id);
  assert.equal(accepted.title, '人工审核后的标题');
  assert.equal(accepted.content, original.content);
  assert.deepEqual(
    accepted.domains.map((t) => t.id),
    ['domains-id'],
  );
  assert.equal(accepted.tags.length, 2);
  // Note preview is plain text. Adopting appends escaped prose, preserving original HTML/images.
  await page
    .locator('.task-row')
    .filter({ has: page.getByRole('link', { name: note.title, exact: true }) })
    .locator('.action-menu>summary')
    .click();
  await page.getByRole('button', { name: '编辑 / 移动归属', exact: true }).click();
  await page.getByRole('button', { name: 'AI 整理笔记', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'AI 整理稿预览', exact: true })).toBeVisible();
  assert.deepEqual(await get('/entries/' + note.id), note);
  await page.getByRole('textbox', { name: 'AI 推荐标题', exact: true }).fill('审核后的笔记');
  await page.getByRole('textbox', { name: 'AI 整理稿预览', exact: true }).press('End');
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v1.2-' + provider + '-note-preview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await page.screenshot({ path: 'test-results/v1.2-' + provider + '-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '接受全部建议', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator('.tiptap strong')).toHaveText('重要事实');
  await expect(page.locator('.tiptap img')).toHaveCount(1);
  assert.equal(
    await page.locator('.tiptap img').evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  assert.equal(await page.evaluate(() => window.AI_XSS), undefined);
  assert.deepEqual(await get('/entries/' + note.id), note);
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const adopted = await get('/entries/' + note.id);
  assert.ok(adopted.content.startsWith(note.content));
  assert.ok(adopted.content.includes('AI 整理稿（原文保留）'));
  assert.ok(adopted.content.includes('&lt;script&gt;'));
  assert.ok(!adopted.content.includes('<script>'));
  await page.getByRole('link', { name: '审核后的笔记', exact: true }).click();
  await page.screenshot({ path: 'test-results/v1.2-' + provider + '-note-reading.png' });
  await closeSurface();
  // Errors, timeout and cancel never alter the editor/DB; manual save is still available.
  await page
    .locator('.task-row')
    .filter({ has: page.getByRole('link', { name: '人工审核后的标题', exact: true }) })
    .locator('.action-menu>summary')
    .click();
  await page.getByRole('button', { name: '编辑 / 移动归属', exact: true }).click();
  behavior = 'error';
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(page.locator('.ai-assist [role="alert"]')).toContainText('AI 服务返回错误');
  behavior = 'wait';
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(page.locator('.ai-assist [role="alert"]')).toContainText('超时');
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await page.getByRole('button', { name: '取消 AI 请求', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存条目', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue(
    accepted.title,
  );
  assert.deepEqual(await get('/entries/' + original.id), accepted);
  await closeSurface();
  // Locally insufficient URL-only entry does not call transport.
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: '网站收藏', exact: true }).click();
  await page
    .getByRole('textbox', { name: '网址', exact: true })
    .fill('https://www.douyin.com/video/987654321');
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('只有网址');
  const before = calls;
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(page.locator('.ai-review')).toContainText('信息不足');
  assert.equal(calls, before);
  page.once('dialog', (d) => d.accept());
  await closeSurface();
  // A genuinely unconfigured backend remains fully functional in the same built frontend.
  noKeyStore = createApp(noKeyDir, { ai: { env: { PK_AI_PROVIDER: provider } } });
  noKeyServer = noKeyStore.app.listen(0, '127.0.0.1');
  await new Promise((r) => noKeyServer.once('listening', r));
  await page.goto('http://127.0.0.1:' + noKeyServer.address().port);
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: '网站收藏', exact: true }).click();
  await page.getByRole('textbox', { name: '网址', exact: true }).fill('https://example.com/no-key');
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('无密钥手动收藏');
  await page.getByRole('textbox', { name: '简介', exact: true }).fill(fixtureForm.description);
  await page.getByRole('button', { name: 'AI 帮我整理', exact: true }).click();
  await expect(page.locator('.ai-assist [role="alert"]')).toContainText('尚未配置');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('link', { name: '无密钥手动收藏', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Provider: ' + provider);
  console.log(
    'PASS AI Edge: ID-bound review, reject/edit/select/all, new-tag confirmation, deferred save, original rich HTML/image preservation, escaped model text, mobile, timeout/cancel/error, URL-only insufficient and no-key manual save; no page errors.',
  );
} finally {
  await browser?.close();
  if (noKeyServer) await new Promise((r) => noKeyServer.close(r));
  noKeyStore?.close();
  await new Promise((r) => server.close(r));
  store.close();
  for (const target of [dir, noKeyDir]) rmSync(target, { recursive: true, force: true });
}
