import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { assistantFixture, assistantResponse } from './assistant-fixture.js';
import { fixtureKey, deepSeekFixtureResponse } from './ai-fixture.js';
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-assistant-edge-'));
let calls = 0;
const store = createApp(dir, {
    ai: {
      env: { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
      transport: async (_url, init) => {
        calls++;
        const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
        return deepSeekFixtureResponse(assistantResponse(payload));
      },
    },
  }),
  db = store.getDb(),
  f = assistantFixture(db);
const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
const server = store.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await page.goto(base);
  await page.getByRole('button', { name: '知识助手', exact: true }).click();
  await page.getByRole('textbox', { name: '知识助手问题', exact: true }).fill('没有匹配ZZ981');
  await page.getByRole('button', { name: '本地检索证据', exact: true }).click();
  await expect(page.locator('.reader-hint')).toContainText('没有匹配资料');
  assert.equal(calls, 0);
  await page.getByRole('textbox', { name: '知识助手问题', exact: true }).fill('实验');
  await page.getByRole('button', { name: '本地检索证据', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '证据 小样本实验观察', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '清空证据选择', exact: true }).click();
  await page.getByRole('checkbox', { name: '证据 小样本实验观察', exact: true }).check();
  await page.getByRole('checkbox', { name: '证据 实验分析工具', exact: true }).check();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '根据所选证据回答', exact: true }).click();
  await expect(page.locator('.assistant-answer')).toContainText('模型推断');
  await expect(page.locator('.assistant-answer')).toContainText('已有资料');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/v1.6-answer.png', fullPage: true });
  await page
    .locator('.assistant-answer')
    .getByRole('button', { name: '小样本实验观察', exact: true })
    .first()
    .click();
  await expect(page.locator('.knowledge-document h1')).toHaveText('小样本实验观察');
  await page.getByRole('button', { name: '知识助手', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 整理知识结构', exact: true }).click();
  await page.getByRole('checkbox', { name: '证据 AI工具', exact: true }).check();
  await page.getByRole('checkbox', { name: '证据 AI 工具', exact: true }).check();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '生成结构优化建议', exact: true }).click();
  await expect(page.locator('.assistant-review')).toContainText('合并');
  await page.getByRole('checkbox', { name: '采用结构建议 0', exact: true }).check();
  await page
    .getByRole('textbox', { name: '结构理由 0', exact: true })
    .fill('人工核对，两标签同义，保留全部资源。');
  await page.getByRole('button', { name: '保存前差异预览', exact: true }).click();
  await expect(page.locator('.review-final-diff')).toContainText('原正文保留');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: /^工具库/ }).click();
  await expect(page.locator('.assistant-review')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '结构理由 0', exact: true })).toHaveValue(
    '人工核对，两标签同义，保留全部资源。',
  );
  await page.screenshot({ path: 'test-results/v1.6-structure-review.png', fullPage: true });
  let confirmations = 0;
  const accept = (d) => {
    confirmations++;
    return d.accept();
  };
  page.on('dialog', accept);
  await page.getByRole('button', { name: '确认保存结构变更', exact: true }).click();
  await expect(page.locator('.reader-hint')).toContainText('已事务保存');
  page.off('dialog', accept);
  assert.equal(confirmations, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM tags').get().n, 1);
  assert.equal(
    db.prepare('SELECT count(*) n FROM entry_tags WHERE taxonomy_id=?').get('tag-b').n,
    2,
  );
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
  await page.getByRole('button', { name: '结构变更历史', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '结构变更历史', exact: true });
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '恢复该批次', exact: true }).click();
  await expect(modal).toContainText('尚无已保存');
  assert.equal(db.prepare('SELECT count(*) n FROM tags').get().n, 2);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '跨范围整合', exact: true }).click();
  await page.getByRole('checkbox', { name: '整合范围 研究目录', exact: true }).check();
  await page.getByRole('checkbox', { name: '整合范围 其他', exact: true }).check();
  await page.getByRole('button', { name: '本地展开所选范围', exact: true }).click();
  await page.getByRole('checkbox', { name: '整合知识 小样本实验观察', exact: true }).check();
  await page.getByRole('checkbox', { name: '整合知识 样本修正结论', exact: true }).check();
  await page.getByRole('textbox', { name: '新综合页面标题', exact: true }).fill('人工审核综合研究');
  await page.getByRole('button', { name: '审核跨来源整合 (2)', exact: true }).click();
  modal = page.getByRole('dialog', { name: '知识整合方案 · 人工审核', exact: true });
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '生成候选整合方案', exact: true }).click();
  await expect(modal).toContainText('原知识保持独立');
  await modal.getByRole('textbox', { name: '整合章节标题 0', exact: true }).fill('两阶段观察保留');
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '采用所选建议', exact: true }).click();
  await expect(page.locator('.knowledge-reader h1')).toHaveText('人工审核综合研究');
  await expect(page.locator('.reader-chapter')).toHaveCount(1);
  assert.equal(
    db.prepare('SELECT original_date FROM knowledge_records WHERE entry_id=?').get(f.a.id)
      .original_date,
    '2026-09-01',
  );
  assert.equal(
    db.prepare('SELECT original_date FROM knowledge_records WHERE entry_id=?').get(f.b.id)
      .original_date,
    '2026-09-20',
  );
  assert.equal(
    JSON.stringify(
      db
        .prepare(
          'SELECT * FROM entries WHERE id IN (' +
            JSON.parse(before)
              .map(() => '?')
              .join(',') +
            ') ORDER BY id',
        )
        .all(...JSON.parse(before).map((r) => r.id)),
    ),
    before,
  );
  await page.getByRole('button', { name: '知识助手', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: '知识问答', exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/v1.6-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({ path: 'test-results/v1.6-dark.png' });
  await page.reload();
  await page.getByRole('button', { name: '知识助手', exact: true }).click();
  await page.getByRole('button', { name: '知识目录', exact: true }).click();
  await page
    .locator('.knowledge-actions')
    .getByRole('button', { name: 'AI 整理知识结构', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: 'AI 整理知识结构', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS actual Edge V1.6: SQLite no match, selected QA/inference/citation jump, editable merge review/diff/two confirmations, references and history restore, cross-directory new page/stages/originals, reload/mobile/dark; mock cloud only.',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
