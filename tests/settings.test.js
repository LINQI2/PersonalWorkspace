import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app/server/index.js';
import { windowsProtection, createCredentials } from '../app/server/ai/credentials.js';
import {
  fixtureKey,
  deepSeekFixtureKey,
  fixtureForm,
  fixtureResponse,
  deepSeekFixtureResponse,
  fixtureSuggestion,
} from './ai-fixture.js';
async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-config-')),
    credentialDir = mkdtempSync(path.join(os.tmpdir(), 'pk-vault-'));
  let calls = 0,
    behavior = 'ok',
    store,
    server,
    base;
  const env = { OPENAI_API_KEY: fixtureKey, PK_AI_TIMEOUT_MS: '1000' };
  const transport = async (endpoint, options) => {
    calls++;
    if (behavior === 'wait')
      await new Promise((r, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    if (behavior === 'network') throw Error(deepSeekFixtureKey);
    if (!['ok', 'echo', 'insufficient'].includes(behavior))
      return new Response(
        JSON.stringify({
          error: {
            code: behavior === 'model' ? 'model_not_found' : 'private',
            message: deepSeekFixtureKey,
          },
        }),
        { status: behavior === 'model' ? 404 : Number(behavior) },
      );
    const b = JSON.parse(options.body),
      deep = endpoint.includes('deepseek'),
      p = JSON.parse(deep ? b.messages[1].content : b.input[0].content[0].text);
    assert.equal(
      options.headers.Authorization,
      'Bearer ' + (deep ? deepSeekFixtureKey : fixtureKey),
    );
    const value = p.mode === 'connection' ? { answer: 'ok' } : fixtureSuggestion(p);
    if (behavior === 'echo') value.title = deep ? deepSeekFixtureKey : fixtureKey;
    if (behavior === 'insufficient') value.status = 'insufficient';
    return deep ? deepSeekFixtureResponse(value) : fixtureResponse(value);
  };
  async function launch() {
    store = createApp(dir, { ai: { env, credentialDir, transport } });
    server = store.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await launch();
  async function api(url, method = 'GET', body, headers = {}) {
    const token = (
      await (await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })).json()
    ).token;
    const res = await fetch(base + '/api' + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-PK-Request': '1',
        'X-PK-Session': token,
        Origin: base,
        ...headers,
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      cache: res.headers.get('cache-control'),
      data: res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : Buffer.from(await res.arrayBuffer()),
    };
  }
  async function update(
    provider,
    action = 'replace',
    key = provider === 'deepseek' ? deepSeekFixtureKey : fixtureKey,
  ) {
    const state = (await api('/ai/status')).data;
    return api('/ai/config', 'PUT', {
      provider,
      model: provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini-2025-04-14',
      action,
      key,
      revision: state.settings.revision,
      confirm: action === 'clear' ? '清除密钥' : '保存或替换密钥',
    });
  }
  const closeServer = async () => {
    await new Promise((r) => server.close(r));
    store.close();
  };
  return {
    dir,
    credentialDir,
    env,
    api,
    update,
    get base() {
      return base;
    },
    get store() {
      return store;
    },
    get calls() {
      return calls;
    },
    set behavior(v) {
      behavior = v;
    },
    restart: async () => {
      await closeServer();
      await launch();
    },
    close: async () => {
      await closeServer();
      rmSync(dir, { recursive: true, force: true });
      rmSync(credentialDir, { recursive: true, force: true });
    },
  };
}
test('Windows DPAPI current-user roundtrip, corruption and fail-closed credential replacement', () => {
  const secret = Buffer.from(deepSeekFixtureKey),
    encrypted = windowsProtection('protect', secret);
  assert.ok(!encrypted.includes(secret));
  assert.equal(windowsProtection('unprotect', encrypted).toString(), deepSeekFixtureKey);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-dpapi-'));
  let fail = false;
  const vault = createCredentials(path.join(dir, 'data'), {
    credentialDir: dir,
    env: {},
    protection: (op, b) => {
      if (fail) throw Error('permission denied ' + deepSeekFixtureKey);
      return windowsProtection(op, b);
    },
  });
  try {
    vault.update({
      provider: 'deepseek',
      model: 'deepseek-flash',
      action: 'replace',
      key: deepSeekFixtureKey,
      revision: 'environment',
      confirm: '保存或替换密钥',
    });
    const file = path.join(dir, readdirSync(dir)[0]),
      before = readFileSync(file);
    fail = true;
    assert.throws(
      () => vault.config(true),
      (e) => e.code === 'secure_storage' && !e.message.includes(deepSeekFixtureKey),
    );
    vault.testResult(vault.publicState().revision, 'secure_storage');
    assert.deepEqual(readFileSync(file), before);
    assert.ok(vault.publicState().storageError);
    assert.equal(vault.publicState().lastTest.code, 'secure_storage');
    assert.throws(() =>
      vault.update({
        provider: 'deepseek',
        model: 'deepseek-flash',
        action: 'clear',
        revision: vault.publicState().revision,
        confirm: '清除密钥',
      }),
    );
    assert.deepEqual(readFileSync(file), before);
    fail = false;
    assert.equal(vault.config(true).key, deepSeekFixtureKey);
    const saved = JSON.parse(before);
    saved.keys.deepseek = Buffer.from('corrupt DPAPI blob').toString('base64');
    writeFileSync(file, JSON.stringify(saved));
    const corrupted = readFileSync(file);
    assert.throws(
      () => vault.config(true),
      (e) => e.code === 'secure_storage',
    );
    assert.throws(() =>
      vault.update({
        provider: 'deepseek',
        model: 'deepseek-flash',
        action: 'replace',
        key: fixtureKey,
        revision: saved.revision,
        confirm: '保存或替换密钥',
      }),
    );
    assert.deepEqual(readFileSync(file), corrupted);
    const swapped = JSON.parse(before);
    swapped.provider = 'openai';
    swapped.model = 'gpt-4.1-mini-2025-04-14';
    swapped.keys.openai = swapped.keys.deepseek;
    swapped.keys.deepseek = null;
    writeFileSync(file, JSON.stringify(swapped));
    assert.throws(
      () => vault.config(true),
      (e) => e.code === 'secure_storage',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('protected configuration persists through restart, overrides env, switches/clears without fallback; no secret in API/DB/ZIP', async () => {
  const f = await fixture();
  try {
    let s = (await f.api('/ai/status')).data;
    assert.equal(s.settings.source, 'environment');
    assert.equal(s.configured, true);
    assert.equal(f.calls, 0);
    const saved = await f.update('deepseek');
    assert.equal(saved.status, 200);
    assert.equal(saved.data.provider, 'deepseek');
    assert.equal(saved.data.configured, true);
    assert.equal(saved.data.settings.lastTest, null);
    assert.equal(f.calls, 0);
    assert.ok(!JSON.stringify(saved.data).includes(deepSeekFixtureKey));
    assert.ok(
      !readFileSync(path.join(f.credentialDir, readdirSync(f.credentialDir)[0]), 'utf8').includes(
        deepSeekFixtureKey,
      ),
    );
    await f.restart();
    s = (await f.api('/ai/status')).data;
    assert.equal(s.provider, 'deepseek');
    assert.equal(s.configured, true);
    assert.equal(s.settings.source, 'windows');
    assert.equal(
      (await f.api('/ai/test', 'POST', { confirm: '测试连接可能产生费用' })).status,
      200,
    );
    assert.equal(f.calls, 1);
    s = (await f.api('/ai/status')).data;
    assert.equal(s.settings.lastTest.state, 'success');
    assert.equal(s.lastSuccess, null);
    await f.restart();
    assert.equal((await f.api('/ai/status')).data.settings.lastTest.state, 'success');
    f.behavior = 'echo';
    const echo = await f.api('/ai/suggest', 'POST', { mode: 'bookmark', form: fixtureForm });
    assert.equal(echo.data.code, 'invalid_output');
    assert.ok(!JSON.stringify(echo.data).includes(deepSeekFixtureKey));
    f.behavior = 'ok';
    assert.equal(
      (await f.api('/ai/suggest', 'POST', { mode: 'bookmark', form: fixtureForm })).data.suggestion
        .status,
      'ready',
    );
    const readyTime = (await f.api('/ai/status')).data.lastSuccess;
    assert.ok(readyTime);
    f.behavior = 'insufficient';
    assert.equal(
      (await f.api('/ai/suggest', 'POST', { mode: 'bookmark', form: fixtureForm })).data.suggestion
        .status,
      'insufficient',
    );
    assert.equal((await f.api('/ai/status')).data.lastSuccess, readyTime);
    f.behavior = 'ok';
    assert.equal((await f.update('openai', 'keep')).data.configured, false);
    assert.equal((await f.update('openai')).data.configured, true);
    assert.equal((await f.update('deepseek', 'keep')).data.configured, true);
    assert.equal((await f.update('deepseek', 'clear')).data.configured, false);
    await f.restart();
    assert.equal((await f.api('/ai/status')).data.configured, false);
    assert.equal((await f.api('/entries', 'POST', fixtureForm)).status, 200);
    await f.update('deepseek');
    const zip = (await f.api('/backup', 'POST')).data;
    for (const e of new AdmZip(zip).getEntries()) {
      assert.ok(!e.getData().includes(Buffer.from(deepSeekFixtureKey)));
      assert.ok(!e.entryName.includes('credential'));
    }
    const data = readFileSync(path.join(f.dir, 'library.sqlite'));
    assert.ok(!data.includes(Buffer.from(deepSeekFixtureKey)));
    assert.ok(
      !readFileSync(path.join(f.dir, 'ai-usage.json'), 'utf8').includes(deepSeekFixtureKey),
    );
    const restore = new FormData();
    restore.append('backup', new Blob([zip]), 'safe.zip');
    restore.append('confirm', '恢复当前知识库');
    const token = (
      await (
        await fetch(f.base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json()
    ).token;
    assert.equal(
      (
        await fetch(f.base + '/api/restore', {
          method: 'POST',
          headers: { 'X-PK-Request': '1', Origin: f.base, 'X-PK-Session': token },
          body: restore,
        })
      ).status,
      200,
    );
    assert.equal((await f.api('/ai/status')).data.configured, true);
  } finally {
    await f.close();
  }
});
test('credential API rejects CSRF/rebinding/missing confirmation and redacts malformed JSON', async () => {
  const f = await fixture();
  try {
    const state = (await f.api('/ai/status')).data,
      body = {
        provider: 'deepseek',
        model: 'deepseek-flash',
        action: 'replace',
        revision: state.settings.revision,
        key: deepSeekFixtureKey,
        confirm: '保存或替换密钥',
      };
    for (const headers of [
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { Origin: '' },
      { 'X-PK-Session': 'bad' },
      { 'X-PK-Request': '' },
      { Host: 'evil.example' },
      { Host: 'localhost:1' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const result = headers.Host
        ? await new Promise((resolve, reject) => {
            const req = httpRequest(
              f.base + '/api/ai/config',
              {
                method: 'PUT',
                headers: {
                  ...headers,
                  'Content-Type': 'application/json',
                  'X-PK-Request': '1',
                  Origin: f.base,
                },
              },
              (res) => {
                res.resume();
                resolve({ status: res.statusCode });
              },
            );
            req.on('error', reject);
            req.end(JSON.stringify(body));
          })
        : await f.api('/ai/config', 'PUT', body, headers);
      assert.equal(result.status, 403, Object.keys(headers).join(','));
    }
    assert.equal(
      (await f.api('/ai/config', 'PUT', { ...body, confirm: '' })).data.code,
      'confirmation',
    );
    assert.equal(
      (await f.api('/ai/config', 'PUT', { ...body, model: 'evil-model' })).data.code,
      'config',
    );
    assert.equal(
      (await f.api('/ai/config', 'PUT', { ...body, provider: '__proto__' })).data.code,
      'config',
    );
    assert.equal((await f.api('/ai/config', 'PUT', body)).status, 200);
    assert.equal((await f.api('/ai/config', 'PUT', body)).data.code, 'config_changed');
    const session = (
      await (
        await fetch(f.base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json()
    ).token;
    const logs = [],
      old = console.error;
    console.error = (...x) => logs.push(x.join(' '));
    try {
      const r = await fetch(f.base + '/api/ai/config', {
        method: 'PUT',
        headers: {
          'X-PK-Request': '1',
          'X-PK-Session': session,
          Origin: f.base,
          'Content-Type': 'application/json',
        },
        body: '{"key":"' + deepSeekFixtureKey,
      });
      assert.equal(r.status, 400);
      assert.ok(!(await r.text()).includes(deepSeekFixtureKey));
    } finally {
      console.error = old;
    }
    assert.ok(!logs.join('').includes(deepSeekFixtureKey));
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
});
test('connection tests classify only evidenced upstream errors, bound/cancel calls and preserve data', async () => {
  const f = await fixture();
  try {
    await f.update('deepseek');
    const before = (await f.api('/entries')).data;
    for (const [behavior, code] of [
      ['401', 'invalid_key'],
      ['402', 'balance'],
      ['429', 'upstream_rate'],
      ['model', 'model'],
      ['500', 'upstream'],
      ['network', 'network'],
      ['wait', 'timeout'],
    ]) {
      f.behavior = behavior;
      const result = await f.api('/ai/test', 'POST', { confirm: '测试连接可能产生费用' });
      assert.equal(result.data.code, code);
      assert.ok(!JSON.stringify(result.data).includes(deepSeekFixtureKey));
      assert.equal((await f.api('/ai/status')).data.settings.lastTest.code, code);
    }
    assert.deepEqual((await f.api('/entries')).data, before);
    assert.equal((await f.api('/ai/status')).data.lastSuccess, null);
    assert.equal((await f.api('/ai/test', 'POST', {})).data.code, 'confirmation');
    assert.equal(f.calls, 7);
    f.behavior = 'ok';
    assert.equal(
      (await f.api('/ai/test', 'POST', { confirm: '测试连接可能产生费用' })).status,
      200,
    );
    assert.equal((await f.api('/ai/status')).data.usage.recordedRequests, 8);
    f.behavior = 'wait';
    const controller = new AbortController();
    const token = (
      await (
        await fetch(f.base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json()
    ).token;
    const pending = fetch(f.base + '/api/ai/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PK-Request': '1',
        'X-PK-Session': token,
        Origin: f.base,
      },
      signal: controller.signal,
      body: JSON.stringify({ confirm: '测试连接可能产生费用' }),
    });
    for (let i = 0; i < 30 && f.calls < 9; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(f.calls, 9);
    assert.equal((await f.update('openai', 'keep')).data.code, 'busy');
    controller.abort();
    await assert.rejects(pending);
    for (let i = 0; i < 30; i++) {
      if ((await f.api('/ai/status')).data.settings.lastTest?.code === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((await f.api('/ai/status')).data.settings.lastTest.code, 'cancelled');
    assert.deepEqual((await f.api('/entries')).data, before);
  } finally {
    await f.close();
  }
});
