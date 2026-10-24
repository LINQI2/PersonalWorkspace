import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../app/server/index.js';
import {
  fixtureKey,
  deepSeekFixtureKey,
  fixtureResponse,
  deepSeekFixtureResponse,
} from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-settings-edge-')),
  credentialDir = mkdtempSync(path.join(os.tmpdir(), 'pk-settings-vault-'));
let calls = 0,
  stopRequested = false;
const store = createApp(dir, {
  onShutdown: () => (stopRequested = true),
  ai: {
    env: { OPENAI_API_KEY: fixtureKey },
    credentialDir,
    transport: async (endpoint, options) => {
      calls++;
      const deep = endpoint.includes('deepseek'),
        expected = deep ? deepSeekFixtureKey : fixtureKey;
      if (options.headers.Authorization !== 'Bearer ' + expected)
        return new Response('private ' + expected, { status: 401 });
      return deep ? deepSeekFixtureResponse({ answer: 'ok' }) : fixtureResponse({ answer: 'ok' });
    },
  },
});
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await page.goto(base);
  const open = () => page.getByRole('button', { name: /^AI ·/ }).click();
  await open();
  const panel = page.getByLabel('AI 安全配置', { exact: true });
  await panel.getByRole('combobox', { name: 'AI 提供商', exact: true }).selectOption('deepseek');
  const password = panel.getByRole('textbox', { name: '新 API Key', exact: true });
  await password.fill(deepSeekFixtureKey);
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '安全保存或替换密钥', exact: true }).click();
  await expect(
    panel.getByText('已安全保存配置；无需重启，不会自动请求模型。', { exact: true }),
  ).toBeVisible();
  await expect(password).toHaveValue('');
  assert.equal(calls, 0);
  const connection = panel.getByRole('button', { name: '测试连接（可能产生费用）', exact: true });
  page.once('dialog', (d) => d.dismiss());
  await connection.click();
  assert.equal(calls, 0);
  page.once('dialog', (d) => d.accept());
  await connection.click();
  await expect(panel.getByText(/连接测试成功：真实请求/)).toBeVisible();
  assert.equal(calls, 1);
  assert.equal(
    await page.evaluate(
      () => localStorage.length === 0 || !JSON.stringify({ ...localStorage }).includes('test-only'),
    ),
    true,
  );
  assert.ok(
    !(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).includes(
      deepSeekFixtureKey,
    ),
  );
  mkdirSync('test-results', { recursive: true });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v1.3.1-ai-settings.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI · 最近测试成功', exact: true })).toBeVisible();
  await page.reload();
  await open();
  await expect(panel.getByText(/最近连接测试：成功/)).toBeVisible();
  await password.fill('synthetic-wrong-key');
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '安全保存或替换密钥', exact: true }).click();
  await expect(password).toHaveValue('');
  page.once('dialog', (d) => d.accept());
  await connection.click();
  await expect(panel.locator('[role=alert]')).toContainText('401');
  await expect(panel.getByText(/最近连接测试：失败/)).toBeVisible();
  await panel.getByRole('combobox', { name: 'AI 提供商' }).selectOption('openai');
  await panel.getByRole('button', { name: '应用 Provider 和模型', exact: true }).click();
  await expect(panel.getByText('AI 未就绪', { exact: true })).toBeVisible();
  await password.fill(fixtureKey);
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '安全保存或替换密钥', exact: true }).click();
  await expect(password).toHaveValue('');
  page.once('dialog', (d) => d.accept());
  await connection.click();
  await expect(panel.getByText(/最近连接测试：成功/)).toBeVisible();
  await panel.getByRole('combobox', { name: 'AI 提供商' }).selectOption('deepseek');
  await password.fill(deepSeekFixtureKey);
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '安全保存或替换密钥', exact: true }).click();
  await expect(password).toHaveValue('');
  page.once('dialog', (d) => d.dismiss());
  await panel.getByRole('button', { name: '清除所选密钥', exact: true }).click();
  await expect(panel.getByText('已配置（不代表连接成功）', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '清除所选密钥', exact: true }).click();
  await expect(panel.getByText('AI 未就绪', { exact: true })).toBeVisible();
  await expect(connection).toBeDisabled();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: '网站收藏', exact: true }).click();
  await page.getByRole('button', { name: '原创笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('无密钥仍可手工保存');
  await page.locator('.tiptap').fill('普通笔记内容正常持久化。');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByRole('link', { name: '无密钥仍可手工保存', exact: true })).toBeVisible();
  await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: 'test-results/v1.3.1-ai-settings-mobile.png',
    animations: 'disabled',
  });
  const disk = readFileSync(path.join(credentialDir, readdirSync(credentialDir)[0]), 'utf8');
  assert.ok(!disk.includes(fixtureKey));
  assert.ok(!disk.includes(deepSeekFixtureKey));
  await page.getByRole('tab', { name: '本地运行', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '正常停止网站', exact: true }).click();
  await expect(page.getByText(/网站已收到停止请求/)).toBeVisible();
  await expect.poll(() => stopRequested).toBe(true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Edge settings: real DPAPI first save/reload, confirmation, mock paid-test consent/success/401, provider switch/replace/clear, no browser persistence/plaintext, manual notes with no key, responsive and stop UI; zero page errors.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(credentialDir, { recursive: true, force: true });
}
