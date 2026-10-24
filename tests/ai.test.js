import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { createAiService } from '../app/server/ai/service.js';
import { readAiConfig, tokenUsage, OpenAIProvider } from '../app/server/ai/provider.js';
import { fixtureKey, fixtureForm, fixtureSuggestion, fixtureResponse } from './ai-fixture.js';
const env = { OPENAI_API_KEY: fixtureKey };
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-ai-'));
const seed = (db) => {
  for (const k of ['domains', 'tags', 'collections'])
    db.prepare(`INSERT INTO ${k} VALUES(?,?)`).run(k + '-id', '现有' + k);
  return saveEntry(db, fixtureForm);
};
const waitTransport = async (_, options) => {
  await new Promise((resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason);
    else
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
};
test('AI config restricts endpoint/model/limits; missing/malformed usage is unknown', () => {
  for (const target of [
    'http://localhost:11434/v1/responses',
    'https://evil.example/v1/responses',
    'https://api.openai.com/v1/responses?key=x',
    'https://user:secret@api.openai.com/v1/responses',
  ])
    assert.throws(() => readAiConfig({ ...env, PK_AI_ENDPOINT: target }), /配置无效/);
  for (const extra of [
    { PK_AI_MODEL: 'unknown' },
    { PK_AI_TIMEOUT_MS: '0' },
    { PK_AI_MAX_CALLS_PER_HOUR: '1000' },
    { PK_AI_PROVIDER: 'ollama' },
  ])
    assert.throws(() => readAiConfig({ ...env, ...extra }));
  assert.equal(readAiConfig({}).key, '');
  assert.equal(tokenUsage(undefined), null);
  assert.equal(tokenUsage({ input_tokens: -1, output_tokens: 1 }), null);
  assert.equal(
    tokenUsage({
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 100 },
    }).estimatedUSD,
    0.00069,
  );
});
test('AI integration: strict schema, scoped payload, no mutation, secret-free ledger and genuine backup/restore', async () => {
  const dir = temp();
  let lastBody,
    calls = 0,
    valueOverride;
  const transport = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error');
    lastBody = JSON.parse(options.body);
    const input = JSON.parse(lastBody.input[0].content[0].text);
    assert.equal(lastBody.store, false);
    assert.equal(lastBody.text.format.strict, true);
    assert.equal(lastBody.text.format.schema.additionalProperties, false);
    assert.equal(lastBody.tools, undefined);
    assert.equal(input.url, undefined);
    assert.equal(input.note.includes('<h2>'), false);
    assert.ok(input.taxonomy.domains.some((t) => t.id === 'domains-id'));
    return fixtureResponse(valueOverride || fixtureSuggestion(input));
  };
  const store = createApp(dir, { ai: { env, transport } });
  const original = seed(store.getDb());
  // An unrelated private record must never enter the AI request.
  saveEntry(store.getDb(), {
    ...fixtureForm,
    type: 'note',
    url: '',
    title: 'UNRELATED-PRIVATE-RECORD',
    content: '<p>UNRELATED-SECRET-CONTENT</p>',
  });
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (url, body) => {
    const response = await fetch(base + '/api' + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PK-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json() };
  };
  try {
    const input = { mode: 'bookmark', form: fixtureForm };
    for (const form of [
      { ...fixtureForm, description: '', content: '' },
      {
        ...fixtureForm,
        description: 'https://www.zhihu.com/question/12345678900000000000000',
        content: '',
      },
    ]) {
      const result = await request('/ai/suggest', { ...input, form });
      assert.equal(result.data.suggestion.status, 'insufficient');
    }
    assert.equal(calls, 0);
    const generated = await request('/ai/suggest', input);
    assert.equal(generated.response.status, 200);
    assert.deepEqual(generated.data.suggestion.domains, ['domains-id']);
    assert.deepEqual(generated.data.suggestion.tags, ['tags-id']);
    assert.deepEqual((await request('/entries/' + original.id)).data, original);
    assert.equal((await request('/meta')).data.tags.length, 1);
    assert.ok(!JSON.stringify(lastBody).includes('UNRELATED'));
    assert.ok(!JSON.stringify(lastBody).includes(fixtureForm.url));
    valueOverride = { ...generated.data.suggestion, domains: ['invented-id'] };
    assert.equal((await request('/ai/suggest', input)).data.code, 'invalid_output');
    valueOverride = { ...generated.data.suggestion, injected: 'extra' };
    assert.equal((await request('/ai/suggest', input)).data.code, 'invalid_output');
    valueOverride = null;
    assert.equal(
      (await request('/ai/suggest', { mode: 'note', form: fixtureForm })).data.suggestion.sections
        .length,
      1,
    );
    assert.equal(
      (
        await request('/ai/suggest', {
          mode: 'note',
          form: { ...fixtureForm, content: '<p>' + '字'.repeat(12001) + '</p>' },
        })
      ).data.code,
      'input',
    );
    const status = (await request('/ai/status')).data;
    assert.equal(status.usage.recordedRequests, 4);
    assert.ok(status.usage.inputTokens > 0);
    const ledger = readFileSync(path.join(dir, 'ai-usage.json'), 'utf8');
    for (const secret of [
      fixtureKey,
      fixtureForm.title,
      fixtureForm.description,
      fixtureForm.url,
      'UNRELATED',
      '重要事实',
    ])
      assert.ok(!ledger.includes(secret));
    assert.ok(!JSON.stringify(status).includes(fixtureKey));
    const backup = await fetch(base + '/api/backup', {
      method: 'POST',
      headers: { 'X-PK-Request': '1' },
    });
    const bytes = Buffer.from(await backup.arrayBuffer());
    const zip = new AdmZip(bytes);
    assert.ok(!zip.getEntries().some((e) => /ai-usage|\.env|lock/.test(e.entryName)));
    for (const file of zip.getEntries())
      assert.ok(!file.getData().includes(Buffer.from(fixtureKey)));
    await fetch(base + '/api/entries/' + original.id, {
      method: 'DELETE',
      headers: { 'X-PK-Request': '1' },
    });
    const form = new FormData();
    form.append('backup', new Blob([bytes]), 'backup.zip');
    form.append('confirm', '恢复当前知识库');
    assert.equal(
      (
        await fetch(base + '/api/restore', {
          method: 'POST',
          headers: { 'X-PK-Request': '1' },
          body: form,
        })
      ).status,
      200,
    );
    assert.deepEqual((await request('/entries/' + original.id)).data, original);
    // Restored DB accessor is live, and usage limits survive service recreation.
    await request('/ai/suggest', input);
    assert.equal(
      createAiService(dir, store.getDb, { env, transport }).status().usage.recordedRequests,
      5,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('AI missing key/corrupt ledger never disables manual persistence', async () => {
  const dir = temp();
  const store = createApp(dir, { ai: { env: {} } });
  try {
    seed(store.getDb());
    const ai = createAiService(dir, store.getDb, { env: {} });
    assert.equal(ai.status().configured, false);
    await assert.rejects(
      ai.suggest({ mode: 'note', form: fixtureForm }),
      (e) => e.code === 'not_configured',
    );
    writeFileSync(path.join(dir, 'ai-usage.json'), '{broken');
    assert.equal(createAiService(dir, store.getDb, { env }).status().configured, false);
    await assert.rejects(
      createAiService(dir, store.getDb, { env }).suggest({ mode: 'note', form: fixtureForm }),
      (e) => e.code === 'usage_storage',
    );
    assert.ok(
      saveEntry(store.getDb(), { ...fixtureForm, type: 'note', url: '', title: '手动依然能保存' })
        .id,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('AI timeout, cancellation, concurrent limit, persistent hourly quota and failures preserve data', async () => {
  const dir = temp();
  const store = createApp(dir, { ai: { env: {} } });
  const original = seed(store.getDb());
  const input = { mode: 'note', form: fixtureForm };
  try {
    const ai = createAiService(dir, store.getDb, {
      env: { ...env, PK_AI_TIMEOUT_MS: '1000', PK_AI_MAX_CALLS_PER_HOUR: '2' },
      transport: waitTransport,
    });
    const first = ai.suggest(input);
    await assert.rejects(ai.suggest(input), (e) => e.code === 'busy');
    await assert.rejects(first, (e) => e.code === 'timeout');
    const controller = new AbortController();
    const second = ai.suggest(input, controller.signal);
    controller.abort();
    await assert.rejects(second, (e) => e.code === 'cancelled');
    assert.equal(ai.status().usage.unknownUsage, 2);
    await assert.rejects(
      createAiService(dir, store.getDb, {
        env: { ...env, PK_AI_MAX_CALLS_PER_HOUR: '2' },
        transport: waitTransport,
      }).suggest(input),
      (e) => e.code === 'rate',
    );
    const dbRow = store.getDb().prepare('SELECT content FROM entries WHERE id=?').get(original.id);
    assert.equal(dbRow.content, original.content);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('Provider rejects errors/refusal/truncated/oversize responses without exposing upstream or keys', async () => {
  const config = readAiConfig(env);
  for (const [transport, code] of [
    [
      async () => {
        throw Error('secret upstream text ' + fixtureKey);
      },
      'network',
    ],
    [async () => new Response('secret upstream ' + fixtureKey, { status: 401 }), 'invalid_key'],
    [
      async () =>
        Response.json({ status: 'incomplete', usage: { input_tokens: 1, output_tokens: 2 } }),
      'invalid_output',
    ],
    [
      async () =>
        Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: fixtureKey }] }],
        }),
      'refusal',
    ],
    [async () => new Response('x'.repeat(129 * 1024)), 'invalid_output'],
    [async () => new Response('{bad'), 'invalid_output'],
  ]) {
    await assert.rejects(
      new OpenAIProvider(config, transport).generate({
        input: {},
        schema: {},
        signal: new AbortController().signal,
      }),
      (e) =>
        e.code === code &&
        !e.message.includes(fixtureKey) &&
        !e.message.includes('secret upstream'),
    );
  }
});
