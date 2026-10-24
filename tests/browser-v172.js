import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveRecord, transaction } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
import { validateBackup } from '../app/server/backup.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v171-edge-')),
  store = createApp(dir, { ai: { env: {} } }),
  db = store.getDb();
const form = (title) => ({
  type: 'note',
  title,
  url: '',
  description: '可核对的合成资料简介',
  content: '<h2>核心观点</h2><p>这是合成实验记录，保留真实来源与不同阶段的判断。</p>',
  cover_asset_id: null,
  pinned: 0,
  domains: [],
  tags: [],
  collections: [],
});
const note = saveEntry(db, form('阅读笔记')),
  tool = saveEntry(db, { ...form('实践工具'), resource_kind: 'tool', tool_kind: 'desktop' }),
  bookmark = saveEntry(db, {
    ...form('网页资料'),
    type: 'bookmark',
    url: 'https://example.com/research',
  });
const k = {
    ...form('综合研究文档'),
    kind: 'page',
    directory_id: null,
    priority: 0,
    status: 'review',
    epistemic: 'ai_inference',
    questions: '',
    references: [],
    original_date: '2025-01-02',
    date_note: '',
  },
  doc = saveRecord(db, k),
  chapter = saveRecord(db, { ...k, kind: 'point', title: '研究章节' });
transaction(db, () => attach(db, { items: [{ id: chapter.id, parent_id: doc.id }] }));
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
db.prepare('INSERT INTO domains VALUES(?,?)').run('root', '研究领域');
db.prepare('INSERT INTO domains VALUES(?,?)').run('child', '人物模拟与本地模型的研究实践长名称');
db.prepare('INSERT INTO domain_structure VALUES(?,?,?)').run('root', null, 0);
db.prepare('INSERT INTO domain_structure VALUES(?,?,?)').run('child', 'root', 0);
db.prepare('INSERT INTO tags VALUES(?,?)').run('tag', '实践');
db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '研究专题');
for (const kind of ['domains', 'tags', 'collections'])
  db.prepare('INSERT INTO entry_' + kind + ' VALUES(?,?)').run(
    note.id,
    { domains: 'child', tags: 'tag', collections: 'topic' }[kind],
  );
const before = process.argv.includes('--before');
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [],
    confirmations = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', async (d) => {
    confirmations.push(d.message());
    await d.dismiss();
  });
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  mkdirSync('test-results', { recursive: true });
  await page.goto(base);
  await page
    .getByRole('navigation', { name: '顶部一级导航' })
    .getByRole('button', { name: '知识库', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '阅读内容 综合研究文档', exact: true }),
  ).toBeVisible();
  const shot = async (name) =>
    page.screenshot({ path: 'test-results/v172-after-' + name + '.png', animations: 'disabled' });
  const close = async () =>
    page.getByRole('dialog').last().getByRole('button', { name: '关闭', exact: true }).click();
  const bounds = async () => {
    const d = page.getByRole('dialog').last();
    assert.ok(
      await d.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.bottom <= innerHeight + 1 &&
          r.left >= 0 &&
          r.right <= innerWidth + 1 &&
          !e.closest('.reading-surface')
        );
      }),
    );
    const button = d.getByRole('button', { name: '关闭', exact: true });
    assert.ok(
      await button.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    );
    await d.locator('.dialog-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
    assert.ok(
      await d
        .locator('.dialog-body')
        .evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2),
    );
    await d.locator('.dialog-body').evaluate((e) => (e.scrollTop = 0));
  };
  if (!before) {
    const side = page.locator('.sidebar');
    assert.ok(
      await side.evaluate((e) =>
        Array.from(e.querySelectorAll('.structure-heading,.domain-node')).every(
          (row) => row.getBoundingClientRect().right <= e.getBoundingClientRect().right,
        ),
      ),
    );
    await expect(side.getByRole('button', { name: '管理领域', exact: true })).toBeVisible();
    await side.getByRole('button', { name: '折叠领域 研究领域', exact: true }).click();
    await expect(
      side.getByRole('button', {
        name: '浏览领域 人物模拟与本地模型的研究实践长名称',
        exact: true,
      }),
    ).toHaveCount(0);
    await side.getByRole('button', { name: '浏览领域 研究领域', exact: true }).click();
    await expect(
      side.getByRole('button', { name: '折叠领域 研究领域', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await side.getByRole('button', { name: '折叠领域 研究领域', exact: true }).click();
    await page.getByRole('button', { name: '重置全部筛选', exact: true }).click();
    for (const dimension of ['专题', '标签', '来源', '状态']) {
      await page.getByRole('button', { name: dimension + '筛选', exact: true }).click();
      await expect(page.getByRole('group', { name: dimension + '可选值' })).toBeVisible();
      assert.equal(await page.locator('.filter-options').count(), 1);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.filter-options')).toHaveCount(0);
    await page.getByRole('button', { name: '专题筛选', exact: true }).click();
    await page
      .getByRole('group', { name: '专题可选值' })
      .getByRole('button', { name: '研究专题', exact: true })
      .click();
    await page.getByRole('button', { name: '标签筛选', exact: true }).click();
    await page
      .getByRole('group', { name: '标签可选值' })
      .getByRole('button', { name: '实践', exact: true })
      .click();
    await expect(page.locator('.unified-card')).toHaveCount(1);
    await expect(page.locator('.active-filters')).toContainText('研究专题');
    await expect(page.locator('.active-filters')).toContainText('实践');
    await page.getByRole('button', { name: '来源筛选', exact: true }).click();
    await page.getByRole('textbox', { name: '统一搜索', exact: true }).click();
    await expect(page.locator('.filter-options')).toHaveCount(0);
    await page.getByRole('button', { name: '重置全部筛选', exact: true }).click();
    await page.getByRole('textbox', { name: '统一搜索' }).fill('不存在的合成资料');
    await expect(page.getByRole('heading', { name: '没有匹配的内容' })).toBeVisible();
    await page.getByRole('textbox', { name: '统一搜索' }).fill('');
    await page.getByRole('button', { name: '置顶 阅读笔记', exact: true }).click();
    const pinned = page.getByRole('button', { name: '取消置顶 阅读笔记', exact: true });
    await expect(pinned).toContainText('已置顶');
    await expect(pinned).toHaveClass(/is-pinned/);
    for (const sort of ['updated', 'recent', 'title']) {
      await page.getByRole('combobox', { name: '内容排序' }).selectOption(sort);
      await expect(page.locator('.unified-card').first()).toContainText('阅读笔记');
    }
    await page.getByRole('button', { name: '网格', exact: true }).click();
    await expect(pinned).toBeVisible();
    await shot('grid');
    await page.getByRole('button', { name: '列表', exact: true }).click();
    await shot('library');
    await page.getByRole('button', { name: '阅读内容 阅读笔记', exact: true }).click();
    await page.getByRole('button', { name: '完整阅读', exact: true }).click();
    await expect(
      page.locator('.reading-surface').getByRole('button', { name: '取消置顶 阅读笔记' }),
    ).toContainText('已置顶');
    await page
      .locator('.reading-surface')
      .getByRole('button', { name: '取消置顶 阅读笔记' })
      .click();
    await expect(
      page.locator('.reading-surface').getByRole('button', { name: '置顶 阅读笔记' }),
    ).toBeVisible();
    await shot('note');
    await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
    await page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name: '首页', exact: true })
      .click();
    await expect(page.getByRole('button', { name: '置顶 阅读笔记', exact: true })).toBeVisible();
    await shot('home');
    await page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name: '收集箱', exact: true })
      .click();
    await shot('inbox');
    await page
      .getByRole('navigation', { name: '顶部一级导航' })
      .getByRole('button', { name: '知识库', exact: true })
      .click();
  }
  if (before) {
    await page.locator('.filter-popover summary').filter({ hasText: '专题' }).click();
    await page.locator('.filter-popover summary').filter({ hasText: '标签' }).click();
    console.log(
      'Before mutually open filters',
      await page.locator('.filter-popover[open]').count(),
    );
    await page.screenshot({ path: 'test-results/v172-before-library.png' });
  }
  await page.getByRole('button', { name: '阅读内容 综合研究文档', exact: true }).click();
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await page.getByRole('tab', { name: '知识关联', exact: true }).click();
  await page.locator('.related-panel > summary').click();
  await page.getByRole('button', { name: '关联知识', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '关联知识与人工审核', exact: true });
  await expect(dialog).toBeVisible();
  if (!before) await bounds();
  console.log(
    'Related dialog geometry',
    await dialog.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        screen: innerHeight,
        scroll: e.scrollHeight,
        client: e.clientHeight,
        insideReader: !!e.closest('.reading-surface'),
      };
    }),
  );
  await page.screenshot({ path: `test-results/v172-${before ? 'before' : 'after'}-relations.png` });
  if (before)
    await page.getByRole('button', { name: '关闭', exact: true }).evaluate((e) => e.click());
  else await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.reader-workbench').last()).toBeVisible();
  if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
    await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
  await page.getByRole('tab', { name: '上下文 AI', exact: true }).click();
  await page.getByRole('button', { name: '就此内容询问 AI', exact: true }).click();
  if (!before) await bounds();
  console.log(
    'AI dialog geometry',
    await page.getByRole('dialog').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        screen: innerHeight,
        insideReader: !!e.closest('.reading-surface'),
      };
    }),
  );
  await page.screenshot({ path: `test-results/v172-${before ? 'before' : 'after'}-context.png` });
  if (before)
    await page.getByRole('button', { name: '关闭', exact: true }).evaluate((e) => e.click());
  else await page.getByRole('button', { name: '关闭', exact: true }).click();
  if (!before) {
    await page.getByRole('button', { name: '整理模式', exact: true }).click();
    await page.getByRole('button', { name: '收纳已有知识点', exact: true }).click();
    await bounds();
    await shot('collect');
    await close();
    await page
      .locator('.reading-surface')
      .getByRole('button', { name: '置顶 综合研究文档', exact: true })
      .click();
    await expect(
      page
        .locator('.reading-surface')
        .getByRole('button', { name: '取消置顶 综合研究文档', exact: true }),
    ).toBeVisible();
    await page
      .locator('.reading-surface')
      .getByRole('button', { name: '取消置顶 综合研究文档', exact: true })
      .click();
    await expect(
      page
        .locator('.reading-surface')
        .getByRole('button', { name: '置顶 综合研究文档', exact: true }),
    ).toBeVisible();
    await shot('document');
  }
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByText('管理与导入', { exact: true }).click();
  await page.getByRole('button', { name: '管理领域树', exact: true }).click();
  if (!before) {
    await bounds();
    const manage = page.getByRole('dialog');
    await manage.getByRole('button', { name: '调整领域 研究领域', exact: true }).click();
    assert.ok(
      !(await manage
        .getByRole('combobox', { name: '父领域', exact: true })
        .locator('option[value="child"]')
        .count()),
    );
    await manage.getByRole('textbox', { name: '领域名称', exact: true }).fill('研究领域（重命名）');
    await manage.getByRole('button', { name: '保存领域', exact: true }).click();
    await expect(
      manage.getByRole('button', { name: '浏览领域 研究领域（重命名）', exact: true }),
    ).toBeVisible();
    await manage
      .getByRole('button', { name: '调整领域 人物模拟与本地模型的研究实践长名称', exact: true })
      .click();
    await manage.getByRole('combobox', { name: '父领域', exact: true }).selectOption('');
    await manage.getByRole('button', { name: '保存领域', exact: true }).click();
    await expect
      .poll(
        () =>
          db.prepare('SELECT parent_id FROM domain_structure WHERE domain_id=?').get('child')
            .parent_id,
      )
      .toBe(null);
    assert.equal(
      db.prepare('SELECT taxonomy_id FROM entry_domains WHERE entry_id=?').get(note.id).taxonomy_id,
      'child',
    );
    await manage
      .getByRole('button', { name: '调整领域 人物模拟与本地模型的研究实践长名称', exact: true })
      .click();
    await manage.getByRole('combobox', { name: '父领域', exact: true }).selectOption('root');
    await manage.getByRole('button', { name: '保存领域', exact: true }).click();
    const rows = manage.locator('.domain-node');
    await expect
      .poll(() =>
        rows
          .filter({ hasText: '人物模拟' })
          .evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)),
      )
      .toBeGreaterThan(0);
    await manage.getByRole('button', { name: '新增 / 取消调整', exact: true }).click();
    await manage.getByRole('textbox', { name: '领域名称', exact: true }).fill('可删除空领域');
    await manage.getByRole('button', { name: '创建领域', exact: true }).click();
    await expect(manage.getByRole('button', { name: '浏览领域 可删除空领域' })).toBeVisible();
  }
  await page.screenshot({ path: `test-results/v172-${before ? 'before' : 'after'}-tree.png` });
  if (before)
    await page.getByRole('button', { name: '关闭', exact: true }).evaluate((e) => e.click());
  else await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '管理领域', exact: true }).click();
  await page.screenshot({ path: `test-results/v172-${before ? 'before' : 'after'}-settings.png` });
  if (!before) {
    await close();
    assert.deepEqual(confirmations, []);
    await page.getByRole('button', { name: '管理领域', exact: true }).click();
    for (const name of [
      'AI 服务',
      '数据与备份',
      '草稿与编辑',
      '本地运行',
      '外观与说明',
      '分类管理',
    ])
      await page.getByRole('tab', { name, exact: true }).click();
    await close();
    assert.deepEqual(confirmations, []);
    await page.getByRole('button', { name: '管理领域', exact: true }).click();
    await page.getByRole('textbox', { name: '分类名称' }).fill('未保存分类');
    await close();
    assert.match(confirmations.pop(), /分类修改/);
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('textbox', { name: '分类名称' }).fill('');
    await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
    await page
      .getByRole('textbox', { name: '新 API Key', exact: true })
      .fill('test-only-not-a-real-key');
    await close();
    assert.match(confirmations.pop(), /AI 配置尚未保存/);
    await expect(page.getByRole('textbox', { name: '新 API Key', exact: true })).toHaveValue(
      'test-only-not-a-real-key',
    );
    await page.getByRole('textbox', { name: '新 API Key', exact: true }).fill('');
    await page.getByRole('combobox', { name: 'AI 提供商', exact: true }).selectOption('deepseek');
    await close();
    assert.match(confirmations.pop(), /AI 配置尚未保存/);
    await page.getByRole('combobox', { name: 'AI 提供商', exact: true }).selectOption('openai');
    await close();
    assert.deepEqual(confirmations, []);
    // Missing upstream model is normalized once at load, not mistaken for a user edit.
    await page.route('**/api/ai/status', async (r) => {
      const response = await r.fetch();
      const body = await response.json();
      body.model = '';
      await r.fulfill({ json: body });
    });
    await page.getByRole('button', { name: '管理领域', exact: true }).click();
    await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'AI 模型', exact: true })).toHaveValue(
      'gpt-4.1-mini-2025-04-14',
    );
    await close();
    assert.deepEqual(confirmations, []);
    await page.unroute('**/api/ai/status');
    await page.getByRole('button', { name: '收起或展开侧栏' }).click();
    await expect(page.getByRole('navigation', { name: '侧栏一级导航' })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: '侧栏一级导航' })
        .getByRole('button', { name: '首页', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '收起或展开侧栏' }).click();
    for (const width of [1920, 390]) {
      await page.setViewportSize({ width, height: 844 });
      if (
        width === 390 &&
        (await page
          .getByRole('button', { name: '收起或展开侧栏' })
          .getAttribute('aria-expanded')) === 'true'
      )
        await page.getByRole('button', { name: '收起或展开侧栏' }).click();
      await page.getByRole('button', { name: '标签筛选', exact: true }).click();
      await expect(
        page
          .getByRole('group', { name: '标签可选值' })
          .getByRole('button', { name: '实践', exact: true }),
      ).toBeVisible();
      await shot('filter-' + width);
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByText('管理与导入', { exact: true }).click();
      await page.getByRole('button', { name: '管理领域树', exact: true }).click();
      await bounds();
      await shot('tree-' + width);
      await close();
      await page
        .locator('.global-topbar')
        .getByRole('button', { name: '设置', exact: true })
        .click();
      await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
      await bounds();
      await shot('settings-' + width);
      await close();
      await page.getByRole('button', { name: '阅读内容 综合研究文档', exact: true }).click();
      await expect(page.locator('.reader-workbench').last()).toBeVisible();
      if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
        await page.getByRole('button', { name: '展开辅助信息', exact: true }).last().click();
      await page.getByRole('tab', { name: '上下文 AI', exact: true }).click();
      await page.getByRole('button', { name: '就此内容询问 AI', exact: true }).click();
      await bounds();
      await shot('context-' + width);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.reading-surface')).toBeVisible();
      await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
      assert.ok(await page.evaluate(() => document.body.style.overflow !== 'hidden'));
    }
    const backup = await page.request.post(base + '/api/backup', {
      headers: { 'X-PK-Request': '1', Origin: base },
    });
    assert.equal(backup.status(), 200);
    const validated = validateBackup(await backup.body(), { upgrade: false });
    assert.equal(validated.sourceSchema, 10);
    validated.dispose();
    assert.deepEqual(errors, []);
    console.log(
      'PASS V1.7.2 regression on V1.8 real Edge: pins/sorts/sync, single direct filters/chips/outside/Escape, settings real dirty isolation/empty model, tree rename/move/IDs/cycle exclusions, portal nested overlays/footer/scroll locks, 1366/1920/390, schema10 ZIP; no paid AI.',
    );
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
