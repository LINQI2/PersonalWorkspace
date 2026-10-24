import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveMap, getMap } from '../app/server/mindmaps.js';
import { newMap, mapNodes } from '../app/shared/mindmap.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v19-edge-')),
  store = createApp(dir, { ai: { env: {} } }),
  db = store.getDb();
const note = saveEntry(db, {
  type: 'note',
  title: '实验依据笔记',
  description: '合成来源',
  content: '<p>来源正文不应被思维导图编辑改动。</p>',
  domains: [],
  tags: [],
  collections: [],
});
const data = newMap('研究与实践');
data.nodeData.children = [
  {
    id: 'a',
    topic: '问题定义',
    children: [
      { id: 'a1', topic: '如何建立可验证假设' },
      { id: 'a2', topic: '记录不同阶段结论' },
    ],
  },
  { id: 'b', topic: '实验方法', children: [{ id: 'b1', topic: '可重复测试' }] },
  { id: 'c', topic: '知识再利用' },
];
const map = saveMap(db, { title: '研究工作流导图', data, domains: [], tags: [], collections: [] });
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }),
    page = await context.newPage(),
    errors = [],
    alerts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => {
    if (d.type() === 'alert') alerts.push(d.message());
    return d.accept();
  });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  mkdirSync('docs/design/v1.9/screens', { recursive: true });
  const shot = (n) =>
    page.screenshot({ path: 'docs/design/v1.9/screens/' + n + '.png', animations: 'disabled' });
  const work = () => page.getByRole('region', { name: '思维导图编辑器' }),
    canvas = () => page.getByLabel('导图画布');
  const open = async () => {
    await page.goto(base + '/#content-' + map.entry.id);
    await expect(work()).toBeVisible();
    await expect(page.locator('me-tpc').filter({ hasText: '研究与实践' })).toBeVisible();
  };
  const saved = async () => {
    await page.waitForTimeout(800);
    await expect(work().getByRole('status')).toHaveText('已保存', { timeout: 10000 });
  };
  const select = async (id) => {
    await page.locator('me-tpc[data-nodeid="me' + id + '"]').click();
  };
  await open();
  await saved();
  const pane = await page.locator('.pk-map-host').boundingBox(),
    surface = await page.locator('.pk-map-host>.map-container').boundingBox();
  assert.ok(pane.height > 700 && Math.abs(pane.height - surface.height) < 2);
  await work().getByRole('button', { name: '明暗主题', exact: true }).click();
  await saved();
  assert.equal(getMap(db, map.entry.id).data.appearance, 'dark');
  await shot('00-dark');
  await work().getByRole('button', { name: '明暗主题', exact: true }).click();
  await saved();
  await shot('01-map');
  // Keyboard does not hijack contenteditable input. New nodes share the same model.
  await select('a');
  await canvas().press('Tab');
  await expect(page.locator('#input-box')).toBeVisible();
  await page.locator('#input-box').fill('新建证据节点');
  await page.locator('#input-box').press('Enter');
  await saved();
  await select('a1');
  await canvas().press('F2');
  await page.locator('#input-box').fill('临时');
  await page.locator('#input-box').fill('');
  await page.locator('#input-box').press('Enter');
  await saved();
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a1').node.topic,
    '如何建立可验证假设',
  );
  assert.ok(mapNodes(getMap(db, map.entry.id).data).some((r) => r.node.topic === '新建证据节点'));
  await canvas().press('Enter');
  await page.locator('#input-box').fill('并列节点');
  await page.locator('#input-box').press('Enter');
  await saved();
  await select('a1');
  await canvas().press('F2');
  await page.locator('#input-box').fill('明确的问题');
  await page.locator('#input-box').press('Enter');
  await saved();
  const nodeCount = mapNodes(getMap(db, map.entry.id).data).length;
  await work().getByRole('button', { name: '复制分支', exact: true }).click();
  await saved();
  assert.equal(mapNodes(getMap(db, map.entry.id).data).length, nodeCount + 1);
  await work().getByRole('button', { name: '撤销', exact: true }).click();
  await saved();
  assert.equal(mapNodes(getMap(db, map.entry.id).data).length, nodeCount);
  await work().getByRole('button', { name: '大纲', exact: true }).click();
  await work().getByRole('button', { name: '节点与关联', exact: true }).click();
  await page.getByRole('button', { name: '折叠或展开 问题定义', exact: true }).click();
  await saved();
  assert.equal(getMap(db, map.entry.id).data.nodeData.children[0].expanded, false);
  await expect(page.locator('me-tpc[data-nodeid="mea1"]')).toHaveCount(0);
  await page.getByRole('button', { name: '折叠或展开 问题定义', exact: true }).click();
  await saved();
  await select('a1');
  await page.getByLabel('连线目标').selectOption('b1');
  await page.getByLabel('连线说明', { exact: true }).fill('问题指导实验');
  await page.getByRole('button', { name: '添加独立连线', exact: true }).click();
  await saved();
  assert.equal(getMap(db, map.entry.id).data.arrows.length, 1);
  await shot('02-crosslink-outline');
  // Reparenting rejects a cycle; outline uses the same IDs and order.
  await select('a');
  await page.getByLabel('节点父级').selectOption('a1');
  await expect(page.getByRole('alert')).toContainText('后代');
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a').parent.id,
    data.nodeData.id,
  );
  await page.getByLabel('节点父级').selectOption('c');
  await saved();
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a').parent.id,
    'c',
  );
  await work().getByRole('button', { name: '撤销', exact: true }).click();
  await saved();
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a').parent.id,
    data.nodeData.id,
  );
  await work().getByRole('button', { name: '重做', exact: true }).click();
  await saved();
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a').parent.id,
    'c',
  );
  await select('a1');
  await page.getByLabel('搜索关联知识').fill('实验依据');
  await page.getByRole('button', { name: '链接当前节点', exact: true }).click();
  await saved();
  await shot('03-knowledge-link');
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'a1').node.metadata.contentId,
    note.id,
  );
  await page.getByRole('button', { name: '打开知识 ↗', exact: true }).click();
  await expect(page.getByRole('button', { name: '← 返回思维导图', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回思维导图', exact: true }).click();
  await expect(work()).toBeVisible();
  await saved();
  // Actual library drag: move a branch to a new parent, then refresh and check.
  await select('b1');
  const from = page.locator('me-tpc[data-nodeid="meb1"]'),
    to = page.locator('me-tpc[data-nodeid="mec"]');
  await from.dragTo(to);
  await saved();
  assert.equal(
    mapNodes(getMap(db, map.entry.id).data).find((r) => r.node.id === 'b1').parent.id,
    'c',
  );
  const before = structuredClone(getMap(db, map.entry.id).data);
  await page.reload();
  await expect(work()).toBeVisible();
  await saved();
  assert.deepEqual(getMap(db, map.entry.id).data, before);
  await work().getByRole('button', { name: '节点与关联', exact: true }).click();
  await select('a1');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await saved();
  assert.ok(!mapNodes(getMap(db, map.entry.id).data).some((r) => r.node.id === 'a1'));
  assert.equal(getMap(db, map.entry.id).data.arrows.length, 0);
  await canvas().press('Control+z');
  await saved();
  assert.ok(mapNodes(getMap(db, map.entry.id).data).some((r) => r.node.id === 'a1'));
  assert.equal(getMap(db, map.entry.id).data.arrows.length, 1);
  // Rapid autosave is serialized, a failed request keeps local recovery; reload resumes it.
  await page.getByLabel('导图标题').fill('快速输入最后的正确标题');
  await saved();
  assert.equal(getMap(db, map.entry.id).entry.title, '快速输入最后的正确标题');
  let fail = true;
  await page.route('**/api/mindmaps/' + map.entry.id, async (r) => {
    if (r.request().method() === 'PUT' && fail)
      await r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '模拟磁盘保存失败' }),
      });
    else await r.continue();
  });
  await page.getByLabel('导图标题').fill('失败后恢复标题');
  await expect(page.getByRole('alert')).toContainText('模拟磁盘');
  assert.notEqual(getMap(db, map.entry.id).entry.title, '失败后恢复标题');
  fail = false;
  await page.reload();
  await expect(page.getByRole('button', { name: '恢复到编辑器', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click();
  await saved();
  assert.equal(getMap(db, map.entry.id).entry.title, '失败后恢复标题');
  // Multi-window compare-and-swap never overwrites newer work.
  const p2 = await context.newPage();
  p2.on('dialog', (d) => d.accept());
  await p2.goto(base + '/#content-' + map.entry.id);
  await expect(p2.getByLabel('导图标题')).toHaveValue('失败后恢复标题');
  await page.getByLabel('导图标题').fill('窗口一已保存');
  await saved();
  await p2.getByLabel('导图标题').fill('窗口二冲突稿');
  await expect(p2.getByRole('alert')).toContainText('其他窗口');
  assert.equal(getMap(db, map.entry.id).entry.title, '窗口一已保存');
  await p2.close();
  // JSON/SVG/PNG/Markdown exports are actual browser downloads, not placeholders.
  await page.getByText('管理与导出', { exact: true }).click();
  const files = {};
  for (const kind of ['JSON', 'SVG', 'PNG', 'MD']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 ' + kind, exact: true }).click();
    const d = await pending;
    const p = await d.path();
    files[kind] = readFileSync(p);
    assert.ok(files[kind].length > 50);
  }
  assert.equal(JSON.parse(files.JSON).data.arrows.length, 1);
  assert.ok(files.SVG.toString().includes('<svg'));
  assert.equal(files.PNG[0], 137);
  assert.ok(files.SVG.toString().includes('研究与实践'));
  const image = await sharp(files.PNG).metadata();
  assert.ok(image.width > 200 && image.height > 100);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/v19-export.png', files.PNG);
  assert.ok(files.MD.toString().includes('Markdown'));
  await page.getByText('管理与导出', { exact: true }).click();
  await select('a2');
  await canvas().press('F2');
  await page.locator('#input-box').fill('字面 <script>alert(1)</script> & <图>');
  await page.locator('#input-box').press('Enter');
  await saved();
  await page.getByText('管理与导出', { exact: true }).click();
  const safePending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const safeDownload = await safePending,
    safeSvg = readFileSync(await safeDownload.path(), 'utf8');
  assert.ok(safeSvg.includes('&lt;script&gt;'));
  assert.ok(!safeSvg.includes('<script') && !safeSvg.includes('<foreignObject'));
  await page.getByText('管理与导出', { exact: true }).click();
  await work().getByRole('button', { name: '撤销', exact: true }).click();
  await saved();
  assert.deepEqual(alerts, []);
  // Import preview creates a new map, leaves current map and its node IDs intact.
  const count = db.prepare('SELECT count(*) n FROM mindmaps').get().n;
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '导图.json', mimeType: 'application/json', buffer: files.JSON });
  await expect(page.getByRole('dialog', { name: '导图导入预览' })).toBeVisible();
  await page.getByRole('button', { name: '确认新建导图', exact: true }).click();
  await expect(work()).toBeVisible();
  await saved();
  assert.equal(db.prepare('SELECT count(*) n FROM mindmaps').get().n, count + 1);
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.getByRole('button', { name: '大纲', exact: true }).click();
    await page.getByRole('button', { name: '节点与关联', exact: true }).click();
    await page.getByRole('button', { name: '适应画布', exact: true }).click();
    await page.waitForTimeout(200);
    const b = await page.locator('.mindmap-workbench').boundingBox();
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 1 && b.y + b.height <= h + 1);
    await shot('04-editor-' + w);
    await page.locator('.map-outline').getByRole('button', { name: '收起' }).click();
    await page.locator('.map-inspector').getByRole('button', { name: '收起' }).click();
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await work().getByRole('button', { name: '← 返回', exact: true }).click();
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await page.getByRole('button', { name: '思维导图', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '阅读内容 窗口一已保存', exact: true }).first(),
  ).toBeVisible();
  await shot('05-library');
  await page.getByLabel('统一搜索').fill('可重复测试');
  await expect(
    page.getByRole('button', { name: '阅读内容 窗口一已保存', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible();
  await shot('06-new');
  await page.getByRole('button', { name: '思维导图', exact: true }).last().click();
  await expect(work()).toBeVisible();
  await saved();
  await shot('07-empty');
  await expect(page.locator('#input-box')).toBeVisible();
  assert.deepEqual(errors, []);
  assert.equal(
    db.prepare('SELECT content FROM entries WHERE id=?').get(note.id).content,
    '<p>来源正文不应被思维导图编辑改动。</p>',
  );
  console.log(
    'V1.9 Edge: keyboard/tree/links/outline/autosave recovery/CAS/4 exports/import/3 viewports/library passed',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
