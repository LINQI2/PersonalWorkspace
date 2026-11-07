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
  page.on('dialog',d=>d.accept());
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
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({ path: `test-results/professional-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.goto(base);
  await page.getByRole('navigation',{name:'侧栏一级导航'}).getByRole('button',{name:'专业知识',exact:true}).click();
  await page.getByRole('button',{name:'导入专业知识',exact:true}).click();
  const domainId=db.prepare('SELECT id FROM professional_domains LIMIT 1').get().id;
  const imported={id:'edge-import',title:'浏览器导入卡片',description:'验证真实导入与恢复',content:'<p>浏览器真实正文，保留来源和版本。</p>',concept_kind:'concept',aliases:['Browser Import'],scope_note:'仅隔离测试，不是正式知识。',professional_domains:[domainId],primary_domain:domainId,sources:[{kind:'website',title:'合成来源',url:'https://example.com/fixture',excerpt:'仅测试依据'}]};
  const dialog=page.getByRole('dialog',{name:'专业知识导入'});
  await dialog.getByLabel('专业JSON').fill(JSON.stringify({format:'professional-knowledge-v1',entries:[imported]}));
  await dialog.getByRole('button',{name:'校验并预览'}).click();
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button',{name:'确认导入专业知识',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('搜索专业知识').fill('浏览器导入');
  await expect(page.locator('.professional-cards h3')).toHaveText(['浏览器导入卡片']);
  await page.locator('.professional-cards>button').click();
  await page.getByRole('button',{name:'人工编辑',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'专业知识编辑'});
  await editor.getByLabel('规范名称').fill('浏览器导入卡片修订');
  await editor.getByRole('button',{name:'审核并保存',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button',{name:'版本历史',exact:true}).click();
  const history=page.getByRole('dialog',{name:'专业知识版本历史'});
  await history.getByRole('button',{name:/修订 1/}).click();
  await history.getByRole('button',{name:'放入编辑器审核'}).click();
  await expect(editor.getByLabel('规范名称')).toHaveValue('浏览器导入卡片');
  await editor.getByRole('button',{name:'审核并保存',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await page.getByLabel('更多操作 浏览器导入卡片', {exact:true}).click();
  await page.getByRole('button',{name:'移入回收站',exact:true}).click();
  await expect(page.locator('.professional-module article')).toContainText('位于专业回收站');
  await page.getByRole('button',{name:'返回列表',exact:true}).click();
  await page.getByRole('button',{name:'专业回收站',exact:true}).click();
  await expect(page.locator('.professional-cards h3')).toHaveText(['浏览器导入卡片']);
  await page.locator('.professional-cards>button').click();
  await page.getByLabel('更多操作 浏览器导入卡片',{exact:true}).click();
  await page.getByRole('button',{name:'恢复内容',exact:true}).click();
  await expect(page.locator('.professional-module article')).not.toContainText('位于专业回收站');
  // The tasks module remains mounted while switching to professional knowledge.
  await page.getByRole('navigation',{name:'侧栏一级导航'}).getByRole('button',{name:'任务台',exact:true}).click();
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.locator('.tw-app .title-input').fill('专业模块往返任务');
  await page.locator('.tw-app .title-input').press('Enter');
  await page.locator('.tw-app .row-title').filter({hasText:'专业模块往返任务'}).click();
  await page.getByPlaceholder('补充说明、链接、下一步动作…（自动保存）').fill('任务备注保持');
  await page.getByLabel('搜索任务',{exact:true}).fill('专业模块往返');
  await expect(page.getByText('已保存',{exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'侧栏一级导航'}).getByRole('button',{name:'专业知识',exact:true}).click();
  await page.getByRole('navigation',{name:'侧栏一级导航'}).getByRole('button',{name:'任务台',exact:true}).click();
  await expect(page.getByLabel('搜索任务',{exact:true})).toHaveValue('专业模块往返');
  await expect(page.getByPlaceholder('补充说明、链接、下一步动作…（自动保存）')).toHaveValue('任务备注保持');
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
