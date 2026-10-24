import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { saveRecord } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
import { fixtureKey, fixtureResponse } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v18-edge-'));
let calls = 0,
  behavior = 'success';
const store = createApp(dir, {
    ai: {
      env: { OPENAI_API_KEY: fixtureKey },
      transport: async (_, o) => {
        calls++;
        if (behavior === 'wait')
          await new Promise((r, j) =>
            o.signal.addEventListener('abort', () => j(o.signal.reason), { once: true }),
          );
        if (behavior === 'error') return new Response('synthetic upstream', { status: 503 });
        return fixtureResponse({
          status: 'ready',
          answer: [
            {
              text: '资料需要继续验证。',
              basis: 'evidence',
              sourceIds: [JSON.parse(JSON.parse(o.body).input[0].content[0].text).sources[0].key],
            },
          ],
          missing: ['仅模拟回答'],
        });
      },
    },
  }),
  db = store.getDb();
const quote = '局部模型需要经过可重复测试，不能只凭一次输出判断。';
const form = (title, content = '<p>上下文说明。' + quote + '后续应记录不同阶段观察。</p>') => ({
  type: 'note',
  title,
  url: '',
  description: '合成研究资料',
  content,
  cover_asset_id: null,
  pinned: 0,
  domains: [],
  tags: [],
  collections: [],
});
const note = saveEntry(db, form('普通笔记')),
  target = saveEntry(db, form('引用目标笔记', '<p>原有目标正文必须保留。</p>')),
  web = saveEntry(db, { ...form('网站收藏'), type: 'bookmark', url: 'https://example.com' }),
  tool = saveEntry(db, {
    ...form('工具经验'),
    resource_kind: 'tool',
    tool_kind: 'website',
    url: 'https://example.com/tool',
  });
const k = (title, kind) => ({
  ...form(title),
  kind,
  directory_id: null,
  priority: 0,
  status: 'review',
  epistemic: 'ai_inference',
  questions: '',
  original_date: null,
  date_note: '',
  references: [],
});
const doc = saveRecord(db, { ...k('综合研究文档', 'page'), content: '<p>研究概览。</p>' }),
  chapters = [];
for (let i = 0; i < 14; i++) {
  const c = saveRecord(db, {
    ...k('研究章节 ' + (i + 1), 'point'),
    content:
      '<p>章节引文：' +
      quote +
      '后续需要验证。</p>' +
      Array.from(
        { length: 28 },
        (_, n) => '<p>独立阅读滚动的合成段落 ' + n + '，保留原始证据和不确定性。</p>',
      ).join(''),
  });
  attach(db, { items: [{ id: c.id, parent_id: i === 2 ? chapters[1].id : doc.id }] });
  chapters.push(c);
}
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  mkdirSync('test-results', { recursive: true });
  const shot = (n) =>
      page.screenshot({ path: 'test-results/v18-' + n + '.png', animations: 'disabled' }),
    nav = (n) =>
      page
        .getByRole('navigation', { name: '顶部一级导航' })
        .getByRole('button', { name: n, exact: true })
        .click();
  await page.goto(base);
  await nav('知识库');
  await page.getByRole('button', { name: '阅读内容 综合研究文档', exact: true }).click();
  await expect(page.locator('.reader-workbench')).toBeVisible();
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (await page.getByRole('button', { name: '展开章节大纲', exact: true }).count())
      await page.getByRole('button', { name: '展开章节大纲', exact: true }).click();
    if (await page.getByRole('button', { name: '展开辅助信息', exact: true }).count())
      await page.getByRole('button', { name: '展开辅助信息', exact: true }).click();
    await expect(page.locator('.reader-left')).toBeVisible();
    await expect(page.locator('.reader-aux')).toBeVisible();
    assert.equal(
      await page
        .locator('.reader-toolbar')
        .getByRole('button', { name: '章节大纲', exact: true })
        .count(),
      0,
    );
    await page
      .getByRole('navigation', { name: '章节大纲' })
      .getByRole('button', { name: '1. 研究章节 1', exact: true })
      .click();
    await expect(page.locator('[data-reading-id="' + chapters[0].id + '"]')).toBeVisible();
    // Let the existing delayed chapter positioning and smooth scroll finish
    // before testing that unrelated pane actions preserve a manual position.
    await page.waitForTimeout(600);
    const main = page.locator('.reading-main');
    await main.evaluate((e) => (e.scrollTop = 350));
    const before = await main.evaluate((e) => e.scrollTop);
    await page.locator('.reader-outline').evaluate((e) => (e.scrollTop = 200));
    assert.equal(await main.evaluate((e) => e.scrollTop), before);
    await page.getByRole('tab', { name: '知识关联', exact: true }).click();
    await page.getByRole('tab', { name: '来源与历史', exact: true }).click();
    assert.equal(await main.evaluate((e) => e.scrollTop), before);
    await shot('dual-' + width);
    await page.getByRole('button', { name: '收起章节大纲', exact: true }).click();
    await expect(page.locator('.reader-aux')).toBeVisible();
    await page.getByRole('button', { name: '关闭辅助面板', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开章节大纲' })).toBeVisible();
    await shot('closed-' + width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  const body = () => page.locator('[data-reading-id="' + chapters[0].id + '"]');
  const select = async () => {
    await body().evaluate((el, q) => {
      el.scrollIntoView({ block: 'start' });
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const p = n.textContent.indexOf(q);
        if (p >= 0) {
          const r = document.createRange();
          r.setStart(n, p);
          r.setEnd(n, p + q.length);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          break;
        }
      }
    }, quote);
    await expect(page.getByRole('toolbar', { name: '原文选区操作' })).toBeVisible();
  };
  await select();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: '原文选区操作' })).toHaveCount(0);
  await expect(page.locator('.knowledge-reader')).toBeVisible();
  await select();
  await shot('selection-toolbar');
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page
    .getByRole('textbox', { name: '个人批注', exact: true })
    .fill('我的判断：先复现，再讨论结论。');
  await page.getByRole('button', { name: '保存个人批注', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '展开辅助信息', exact: true }).click();
  await expect(page.getByText('我的判断：先复现，再讨论结论。', { exact: true })).toBeVisible();
  await shot('annotation');
  await page.getByRole('button', { name: '编辑批注', exact: true }).click();
  await page.getByRole('textbox', { name: '修改批注' }).fill('已编辑：仍需验证。');
  await page.getByRole('button', { name: '保存批注修改' }).click();
  await expect(page.getByText('已编辑：仍需验证。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('pk-quote'))).toBe(true);
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page.getByText('已编辑：仍需验证。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭辅助面板', exact: true }).click();
  await select();
  await page.getByRole('button', { name: '引用到笔记', exact: true }).click();
  await page.getByRole('combobox', { name: '引用目标', exact: true }).selectOption(target.id);
  await page.getByRole('button', { name: '确认追加引用' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.ok(
    db
      .prepare('SELECT content FROM entries WHERE id=?')
      .get(target.id)
      .content.includes('原有目标正文必须保留'),
  );
  assert.equal(
    db.prepare('SELECT count(*) n FROM reading_marks WHERE kind=?').get('citation').n,
    1,
  );
  await select();
  await page.getByRole('button', { name: '引用到笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '新引用笔记标题' }).fill('新建引用笔记');
  await page.getByRole('button', { name: '确认追加引用' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.ok(db.prepare('SELECT id FROM entries WHERE title=?').get('新建引用笔记'));
  await page.getByRole('button', { name: '展开辅助信息', exact: true }).click();
  await shot('citations-sources');
  await page.getByRole('tab', { name: '知识关联', exact: true }).click();
  await page.locator('.related-panel>summary').click();
  await expect(page.getByText(/被引用/).first()).toBeVisible();
  await shot('relationships');
  await page.getByRole('button', { name: '关闭辅助面板', exact: true }).click();
  await select();
  await page.getByRole('button', { name: '建立关联', exact: true }).click();
  await page.getByRole('button', { name: '关联知识', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索关联目标' }).fill('普通笔记');
  await page.getByRole('button', { name: '关联目标 普通笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '关联依据' }).fill('选中原文提供进一步的实践背景');
  await page.getByRole('button', { name: '保存人工关联', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '关联知识与人工审核' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  assert.equal(db.prepare('SELECT count(*) n FROM relation_details').get().n, 1);
  await select();
  await page.getByRole('button', { name: '上下文 AI', exact: true }).click();
  await page.getByRole('button', { name: '就此内容询问 AI' }).click();
  await expect(page.getByRole('textbox', { name: '知识助手问题' })).toHaveValue(new RegExp(quote));
  assert.equal(calls, 0);
  const ask = page.getByRole('textbox', { name: '知识助手问题' }),
    question = await ask.inputValue(),
    generate = page.getByRole('button', { name: '根据所选证据回答', exact: true });
  await expect(generate).toBeEnabled();
  behavior = 'error';
  await generate.click();
  await expect(page.getByText(/AI 服务返回错误/)).toBeVisible();
  await expect(ask).toHaveValue(question);
  behavior = 'wait';
  await generate.click();
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  await expect(ask).toHaveValue(question);
  await expect(generate).toBeEnabled();
  behavior = 'success';
  await generate.click();
  await expect(page.getByText('资料需要继续验证。', { exact: true })).toBeVisible();
  assert.equal(calls, 3);
  await shot('selected-ai-review');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /上下文 AI ·/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .locator('.knowledge-reader>.reader-toolbar')
    .getByRole('button', { name: '← 返回列表', exact: true })
    .click();
  await page.getByRole('button', { name: '阅读内容 引用目标笔记', exact: true }).click();
  await page.getByRole('button', { name: '完整阅读', exact: true }).click();
  await expect(page.locator('.reading-main a[data-reading-mark]')).toBeVisible();
  await page.evaluate(() => CSS.highlights.delete('pk-quote'));
  await page.locator('.reading-main a[data-reading-mark]').click();
  await expect(page.locator('.knowledge-reader')).toBeVisible();
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('pk-quote'))).toBe(true);
  await expect(page.locator('.reading-surface')).toHaveCount(1);
  const markId = db
    .prepare("SELECT id FROM reading_marks WHERE target_id=? AND kind='citation'")
    .get(target.id).id;
  const deep = await context.newPage();
  await deep.goto(base + '/#quote-' + markId);
  await expect(deep.locator('[data-reading-id="' + chapters[0].id + '"]')).toBeVisible();
  await expect.poll(() => deep.evaluate(() => CSS.highlights.has('pk-quote'))).toBe(true);
  await deep.close();
  await page
    .locator('.knowledge-reader>.reader-toolbar')
    .getByRole('button', { name: '返回上一内容', exact: true })
    .click();
  await expect(page.locator('.detail-title h1')).toHaveText('引用目标笔记');
  await page
    .locator('.reading-surface .reader-toolbar')
    .getByRole('button', { name: '← 返回列表', exact: true })
    .click();
  for (const [title, label] of [
    ['普通笔记', 'note'],
    ['网站收藏', 'web'],
    ['工具经验', 'tool'],
  ]) {
    await page.getByRole('button', { name: '阅读内容 ' + title, exact: true }).click();
    await expect(page.getByRole('dialog', { name: '内容预览' })).toBeVisible();
    await shot('preview-' + label);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
  }
  const paste = async () => {
    await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
    await page.getByRole('button', { name: '粘贴文字 / Markdown', exact: true }).click();
  };
  const raw =
    '# 新研究收纳\n研究概览。\n## 核心观点\n- 保留观察\n- 不自动确认事实\n### 待验证\n> 需要重复实验\n[参考资料](https://example.com)';
  await paste();
  await page.getByRole('textbox', { name: '粘贴原始内容' }).fill(raw);
  await page.getByRole('button', { name: '本地解析并预览' }).click();
  await expect(page.getByText('实际保存结构 · 3 项')).toBeVisible();
  await shot('markdown-preview');
  await page.getByRole('button', { name: '确认收纳所选内容' }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('新研究收纳');
  assert.equal(
    db.prepare('SELECT excerpt FROM knowledge_sources WHERE excerpt=?').get(raw).excerpt,
    raw,
  );
  await page
    .locator('.knowledge-reader>.reader-toolbar')
    .getByRole('button', { name: '← 返回列表', exact: true })
    .click();
  await paste();
  await page.getByRole('textbox', { name: '粘贴原始内容' }).fill(raw);
  await page.getByRole('button', { name: '本地解析并预览' }).click();
  await expect(page.getByRole('region', { name: '疑似重复资料' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认收纳所选内容' })).toBeDisabled();
  await page.locator('.dialog-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
  await shot('duplicate-preview');
  const countBefore = db.prepare('SELECT count(*) n FROM entries').get().n;
  await page.getByRole('checkbox', { name: '我已核对，仍要另存所选内容' }).check();
  await page.getByRole('button', { name: '确认收纳所选内容' }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('新研究收纳');
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, countBefore + 3);
  await page
    .locator('.knowledge-reader>.reader-toolbar')
    .getByRole('button', { name: '← 返回列表', exact: true })
    .click();
  await paste();
  await page
    .getByRole('textbox', { name: '粘贴原始内容' })
    .fill('# 保留字面标题\n纯文本不会猜测多条知识。');
  await page.getByRole('combobox', { name: '粘贴解析格式' }).selectOption('text');
  await page.getByRole('combobox', { name: '粘贴内容类型' }).selectOption('note');
  await page.getByRole('textbox', { name: '粘贴标题', exact: true }).fill('人工纯文本资料');
  await page.getByRole('button', { name: '本地解析并预览' }).click();
  await expect(page.getByText('实际保存结构 · 1 项')).toBeVisible();
  await page.getByRole('button', { name: '确认收纳所选内容' }).click();
  await expect(page.locator('.detail-title h1')).toHaveText('人工纯文本资料');
  assert.deepEqual(errors, []);
  console.log(
    'PASS V1.8 real Edge 1920/1366/390 independent dual panes/scroll; selection annotation edit/locate; citation existing/new; backlinks/manual relation/AI scope no automatic calls; paste hierarchy/source/duplicate preview and four content paths.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
