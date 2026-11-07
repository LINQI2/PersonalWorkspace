import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { seedSamples, seedPreview } from '../app/server/professional-seed.js';
import { saveEntry } from '../app/server/store.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-professional-edge-'));
const store = createApp(dir, { ai: { env: {} } }),
  db = store.getDb();
saveEntry(db, {
  type: 'note',
  title: '个人笔记保留',
  description: '',
  content: '<p>个人原文</p>',
  domains: [],
  tags: [],
  collections: [],
});
seedSamples(db, { confirm: '创建已审核专业样例' });
assert.equal(seedPreview(db).cards.length, 0);
assert.equal(db.prepare('SELECT count(*) n FROM professional_domains').get().n, 35);
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  mkdirSync('test-results', { recursive: true });
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    if (width < 760) await page.getByRole('button', { name: '收起或展开侧栏' }).click();
    await page.getByRole('navigation',{name:'侧栏一级导航'}).getByRole('button', { name: '专业知识', exact: true }).click();
    await expect(page.getByRole('region', { name: '专业知识' })).toBeVisible();
    await page.getByLabel('搜索专业知识').fill('Character');
    await expect(page.locator('.professional-cards h3')).toHaveText(['角色控制器']);
    await page.locator('.professional-cards>button').click();
    await expect(page.locator('.professional-module article')).toContainText('Rapier');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `test-results/professional-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  const list = await (await fetch(base + '/api/entries')).json();
  assert.equal(list.total, 1);
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.equal(meta.stats.total, 1);
  const session = await (
    await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
  ).json();
  for (const [space, n] of [
    ['personal', 0],
    ['professional', 1],
    ['all', 1],
  ]) {
    const r = await fetch(base + '/api/assistant/search', {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        'X-PK-Request': '1',
        'X-PK-Session': session.token,
      },
      body: JSON.stringify({ question: '角色控制器', space }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    const entries = body.items.filter((i) => i.kind === 'entries');
    if (n === 0) assert.equal(entries.length, 0);
    else assert.ok(entries.some((e) => e.name === '角色控制器'));
  }
  console.log('Professional Edge three sizes, isolation and AI local retrieval passed');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await store.close();
  rmSync(dir, { recursive: true, force: true });
}
