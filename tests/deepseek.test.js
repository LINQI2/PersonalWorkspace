import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { createAiService } from '../app/server/ai/service.js';
import { readAiConfig, readDeepSeekPrices } from '../app/server/ai/provider.js';
import { DeepSeekProvider, deepSeekUsage } from '../app/server/ai/deepseek.js';
import {
  fixtureKey,
  fixtureForm,
  fixtureSuggestion,
  fixtureResponse,
  deepSeekFixtureKey,
  deepSeekFixtureResponse,
} from './ai-fixture.js';
const env = { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: deepSeekFixtureKey };
const input = { mode: 'note', form: fixtureForm };
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-deepseek-'));
const seed = (db) => {
  for (const k of ['domains', 'tags', 'collections'])
    db.prepare(`INSERT INTO ${k} VALUES(?,?)`).run(k + '-id', '现有' + k);
  return saveEntry(db, fixtureForm);
};
test('DeepSeek config uses only its key/model/HTTPS endpoint and independent peak/custom prices', () => {
  const config = readAiConfig({ ...env, OPENAI_API_KEY: fixtureKey });
  assert.equal(config.provider, 'deepseek');
  assert.equal(config.key, deepSeekFixtureKey);
  assert.equal(config.model, 'deepseek-flash');
  assert.equal(config.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(readAiConfig({ PK_AI_PROVIDER: 'deepseek', OPENAI_API_KEY: fixtureKey }).key, '');
  assert.equal(readAiConfig({ DEEPSEEK_API_KEY: deepSeekFixtureKey }).key, '');
  for (const endpoint of [
    'http://localhost:11434/chat/completions',
    'https://api.openai.com/v1/responses',
    'https://evil.example/chat/completions',
    'https://api.deepseek.com/chat/completions?key=x',
    'https://user:password@api.deepseek.com/chat/completions',
    'https://api.deepseek.com/chat/completions#hash',
  ])
    assert.throws(() => readAiConfig({ ...env, PK_AI_ENDPOINT: endpoint }));
  for (const model of ['gpt-4.1-mini', 'deepseek-chat', 'unknown'])
    assert.throws(() => readAiConfig({ ...env, PK_AI_MODEL: model }));
  assert.deepEqual(config.prices, { input: 0.3, cached: 0.006, output: 1.2 });
  const usage = deepSeekUsage(
    {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 100,
      prompt_cache_miss_tokens: 900,
    },
    config.prices,
  );
  assert.equal(usage.cachedTokens, 100);
  assert.ok(Math.abs(usage.estimatedUSD - 0.0005106) < 1e-12);
  assert.equal(deepSeekUsage(null, config.prices), null);
  assert.equal(deepSeekUsage({ prompt_tokens: -1, completion_tokens: 200 }, config.prices), null);
  assert.equal(
    deepSeekUsage(
      { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 11 },
      config.prices,
    ),
    null,
  );
  assert.equal(
    deepSeekUsage(
      {
        prompt_tokens: 10,
        completion_tokens: 2,
        prompt_cache_hit_tokens: 5,
        prompt_cache_miss_tokens: 10,
      },
      config.prices,
    ),
    null,
  );
  assert.equal(
    deepSeekUsage(
      { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 5 } },
      config.prices,
    ).cachedTokens,
    5,
  );
  assert.equal(
    deepSeekUsage({ prompt_tokens: 10, completion_tokens: 2 }, config.prices).cachedTokens,
    0,
  );
  const custom = readAiConfig({
    ...env,
    PK_AI_DEEPSEEK_INPUT_USD_PER_MILLION: '0.15',
    PK_AI_DEEPSEEK_CACHED_USD_PER_MILLION: '0.003',
    PK_AI_DEEPSEEK_OUTPUT_USD_PER_MILLION: '0.6',
  });
  assert.deepEqual(custom.prices, { input: 0.15, cached: 0.003, output: 0.6 });
  for (const value of ['-1', '', '   ', 'NaN', 'Infinity', '1001'])
    assert.throws(() => readDeepSeekPrices({ PK_AI_DEEPSEEK_INPUT_USD_PER_MILLION: value }));
});
test('DeepSeek local API integration (mock cloud): JSON prompt, strict validation, no mutation or secret backup', async () => {
  const dir = temp();
  let invalid = false,
    calls = 0;
  const transport = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer ' + deepSeekFixtureKey);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.tools, undefined);
    assert.equal(body.text, undefined);
    assert.ok(body.messages[0].content.includes('json'));
    assert.ok(body.messages[0].content.includes('"additionalProperties":false'));
    const payload = JSON.parse(body.messages[1].content);
    assert.equal(payload.url, undefined);
    assert.ok(!payload.note.includes('<h2>'));
    assert.ok(!JSON.stringify(body).includes('UNRELATED_PRIVATE'));
    const value = fixtureSuggestion(payload);
    if (invalid) value.domains = ['invented-id'];
    return deepSeekFixtureResponse(value);
  };
  const store = createApp(dir, { ai: { env: { ...env, OPENAI_API_KEY: fixtureKey }, transport } });
  const original = seed(store.getDb());
  saveEntry(store.getDb(), {
    ...fixtureForm,
    type: 'note',
    url: '',
    title: 'UNRELATED_PRIVATE',
    content: '<p>UNRELATED_PRIVATE_TEXT</p>',
  });
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (url, body) => {
    const res = await fetch(base + '/api' + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PK-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { res, value: await res.json() };
  };
  try {
    const result = await request('/ai/suggest', input);
    assert.equal(result.res.status, 200);
    assert.deepEqual(result.value.suggestion.domains, ['domains-id']);
    assert.deepEqual(result.value.suggestion.tags, ['tags-id']);
    assert.equal(result.value.suggestion.sections.length, 1);
    assert.deepEqual((await request('/entries/' + original.id)).value, original);
    assert.equal((await request('/meta')).value.tags.length, 1);
    invalid = true;
    assert.equal((await request('/ai/suggest', input)).value.code, 'invalid_output');
    assert.deepEqual((await request('/entries/' + original.id)).value, original);
    assert.equal((await request('/ai/status')).value.provider, 'deepseek');
    assert.equal((await request('/ai/status')).value.usage.recordedRequests, 2);
    const before = calls;
    assert.equal(
      (
        await request('/ai/suggest', {
          ...input,
          form: {
            ...fixtureForm,
            description: '',
            content: 'https://www.zhihu.com/question/123456789000000000000',
          },
        })
      ).value.suggestion.status,
      'insufficient',
    );
    assert.equal(calls, before);
    const ledger = readFileSync(path.join(dir, 'ai-usage.json'), 'utf8');
    for (const secret of [
      deepSeekFixtureKey,
      fixtureKey,
      fixtureForm.title,
      fixtureForm.url,
      'UNRELATED_PRIVATE',
    ])
      assert.ok(!ledger.includes(secret));
    const backup = await fetch(base + '/api/backup', {
      method: 'POST',
      headers: { 'X-PK-Request': '1' },
    });
    const zip = new AdmZip(Buffer.from(await backup.arrayBuffer()));
    assert.ok(!zip.getEntries().some((e) => /ai-usage|\.env|lock/.test(e.entryName)));
    for (const file of zip.getEntries())
      assert.ok(!file.getData().includes(Buffer.from(deepSeekFixtureKey)));
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('DeepSeek rejects empty/truncated/fenced/non-schema/tool output and safely records known usage', async () => {
  const dir = temp();
  let response;
  const store = createApp(dir, { ai: { env: {} } });
  const original = seed(store.getDb());
  const ai = createAiService(dir, store.getDb, {
    env: { ...env, PK_AI_MAX_CALLS_PER_HOUR: '100' },
    transport: async () => response,
  });
  const payload = { mode: 'note', taxonomy: { domains: [], tags: [], collections: [] } };
  const value = fixtureSuggestion(payload);
  const usage = { prompt_tokens: 1000, completion_tokens: 200 };
  const completion = (content, finish_reason = 'stop', extra = {}) =>
    Response.json({
      usage,
      choices: [{ finish_reason, message: { role: 'assistant', content, ...extra } }],
    });
  try {
    for (const make of [
      () => completion(''),
      () => completion('   '),
      () => completion(null),
      () => completion('{"status":"ready"'),
      () => completion(JSON.stringify(value), 'length'),
      () => completion('```json\n' + JSON.stringify(value) + '\n```'),
      () => completion(JSON.stringify({ ...value, extra: 'unwanted' })),
      () => completion(JSON.stringify({ ...value, tags: ['nonexistent'] })),
      () => completion(JSON.stringify({ ...value, title: 'x'.repeat(201) })),
      () =>
        completion(JSON.stringify(value), 'stop', {
          tool_calls: [{ function: { name: 'delete_file' } }],
        }),
      () => new Response(''),
      () => new Response('x'.repeat(129 * 1024)),
    ]) {
      response = make();
      await assert.rejects(ai.suggest(input), (e) => e.code === 'invalid_output');
    }
    response = completion('', 'content_filter');
    await assert.rejects(ai.suggest(input), (e) => e.code === 'refusal');
    const status = ai.status();
    assert.equal(status.configured, true);
    assert.equal(status.usage.recordedRequests, 13);
    assert.equal(status.usage.unknownUsage, 2);
    assert.ok(status.usage.inputTokens > 0);
    assert.equal(
      store.getDb().prepare('SELECT content FROM entries WHERE id=?').get(original.id).content,
      original.content,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('DeepSeek timeout/cancel/error/missing key preserve data; no retry', async () => {
  const dir = temp();
  const store = createApp(dir, { ai: { env: {} } });
  const original = seed(store.getDb());
  let calls = 0;
  const transport = async (_, { signal }) => {
    calls++;
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  try {
    const ai = createAiService(dir, store.getDb, {
      env: { ...env, PK_AI_TIMEOUT_MS: '1000' },
      transport,
    });
    const first = ai.suggest(input);
    await assert.rejects(ai.suggest(input), (e) => e.code === 'busy');
    await assert.rejects(first, (e) => e.code === 'timeout');
    const cancel = new AbortController();
    const second = ai.suggest(input, cancel.signal);
    cancel.abort();
    await assert.rejects(second, (e) => e.code === 'cancelled');
    assert.equal(calls, 2);
    await assert.rejects(
      createAiService(dir, store.getDb, {
        env: { PK_AI_PROVIDER: 'deepseek', OPENAI_API_KEY: fixtureKey },
        transport,
      }).suggest(input),
      (e) => e.code === 'not_configured',
    );
    for (const [fake, code] of [
      [
        async () => {
          throw Error(deepSeekFixtureKey);
        },
        'network',
      ],
      [async () => new Response(deepSeekFixtureKey, { status: 401 }), 'invalid_key'],
      [async () => new Response(deepSeekFixtureKey, { status: 429 }), 'upstream_rate'],
      [async () => new Response(deepSeekFixtureKey, { status: 500 }), 'upstream'],
    ]) {
      await assert.rejects(
        new DeepSeekProvider(readAiConfig(env), fake).generate({
          input: {},
          schema: {},
          signal: new AbortController().signal,
        }),
        (e) => e.code === code && !e.message.includes(deepSeekFixtureKey),
      );
    }
    assert.equal(ai.status().usage.unknownUsage, 2);
    assert.equal(
      store.getDb().prepare('SELECT content FROM entries WHERE id=?').get(original.id).content,
      original.content,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('Provider switching preserves legacy/mixed usage and a shared hourly limit', async () => {
  const dir = temp();
  const store = createApp(dir, { ai: { env: {} } });
  seed(store.getDb());
  const openEnv = { OPENAI_API_KEY: fixtureKey, PK_AI_MAX_CALLS_PER_HOUR: '2' };
  const deepEnv = { ...env, PK_AI_MAX_CALLS_PER_HOUR: '2' };
  try {
    const open = createAiService(dir, store.getDb, {
      env: openEnv,
      transport: async (_, options) =>
        fixtureResponse(
          fixtureSuggestion(JSON.parse(JSON.parse(options.body).input[0].content[0].text)),
        ),
    });
    await open.suggest(input);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'ai-usage.json'))).version, 1);
    const deep = createAiService(dir, store.getDb, {
      env: deepEnv,
      transport: async (_, options) =>
        deepSeekFixtureResponse(
          fixtureSuggestion(JSON.parse(JSON.parse(options.body).messages[1].content)),
        ),
    });
    assert.equal(deep.status().usage.recordedRequests, 1);
    await deep.suggest(input);
    const again = createAiService(dir, store.getDb, { env: openEnv });
    assert.equal(again.status().configured, true);
    assert.equal(again.status().usage.recordedRequests, 2);
    await assert.rejects(again.suggest(input), (e) => e.code === 'rate');
    const rows = JSON.parse(readFileSync(path.join(dir, 'ai-usage.json'))).records;
    assert.deepEqual(
      rows.map((r) => r.provider),
      ['openai', 'deepseek'],
    );
    assert.ok(Math.abs(rows[0].usage.estimatedUSD - 0.00069) < 1e-12);
    assert.ok(Math.abs(rows[1].usage.estimatedUSD - 0.0005106) < 1e-12);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
