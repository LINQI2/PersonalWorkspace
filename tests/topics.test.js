import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { saveEntry } from '../app/server/store.js';
import { seedTopic, topicSuggestion } from './v13-fixture.js';
import {
  fixtureKey,
  fixtureForm,
  fixtureResponse,
  deepSeekFixtureKey,
  deepSeekFixtureResponse,
} from './ai-fixture.js';
async function fixture(ai = { env: {} }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-topics-')),
    store = createApp(dir, { ai }),
    entries = seedTopic(store.getDb());
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const api = async (url, method = 'GET', body) => {
    const r = await fetch(base + '/api' + url, {
      method,
      headers: {
        'X-PK-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: r.headers.get('content-type')?.includes('json')
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  };
  return {
    dir,
    base,
    store,
    entries,
    api,
    close: async () => {
      await new Promise((r) => server.close(r));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('topics persist rich summary/images, isolated drafts, optimistic history, associations and real ZIP restore', async () => {
  const f = await fixture();
  const { api, entries } = f;
  try {
    const d = (await api('/collections/topic')).data;
    assert.equal(
      (
        await api('/ai/suggest', 'POST', {
          mode: 'collection',
          collectionId: 'topic',
          ids: entries.slice(0, 3).map((e) => e.id),
        })
      ).status,
      503,
    );
    assert.equal(d.count, 4);
    const png = await sharp({
      create: { width: 50, height: 40, channels: 3, background: '#489c85' },
    })
      .png()
      .toBuffer();
    const image = new FormData();
    image.append('image', new Blob([png], { type: 'image/png' }), 'topic.png');
    const asset = (await api('/assets', 'POST', image)).data;
    const form = {
      name: d.name,
      introduction: '专题介绍',
      content: `<h2>手工总结</h2><p><strong>重要事实</strong><a href="https://example.com">原链接</a></p><ul><li>保留判断</li></ul><img src="${asset.url}"/>`,
      revision: 0,
    };
    const saved = (await api('/collections/topic', 'PUT', form)).data;
    assert.equal(saved.revision, 1);
    assert.ok(saved.content.includes('<strong>'));
    assert.ok(saved.content.includes(asset.url));
    const wform = { ...fixtureForm, type: 'note', url: '', title: '原笔记草稿', collections: [] };
    await api('/drafts/new', 'PUT', { form: wform });
    const originalWorkspace = readFileSync(path.join(f.dir, 'workspace.json'), 'utf8');
    await api('/collections/topic/drafts/manual', 'PUT', {
      ...form,
      content: '<p>专题草稿</p>',
      revision: 1,
    });
    assert.equal(readFileSync(path.join(f.dir, 'workspace.json'), 'utf8'), originalWorkspace);
    assert.equal(
      (await api('/collections/topic/drafts/manual')).data.form.content,
      '<p>专题草稿</p>',
    );
    const second = (
      await api('/collections/topic', 'PUT', { ...form, content: '<h2>替换总结</h2>', revision: 1 })
    ).data;
    assert.equal(second.revision, 2);
    assert.equal((await api('/collections/topic/drafts/manual')).data, null);
    const beforeVersions = (await api('/collections/topic/versions')).data;
    assert.equal(beforeVersions.length, 2);
    const fail = await api('/collections/topic', 'PUT', { ...form, name: '另一专题', revision: 2 });
    assert.equal(fail.status, 400);
    assert.equal((await api('/collections/topic')).data.content, second.content);
    assert.equal((await api('/collections/topic/versions')).data.length, 2);
    assert.equal((await api('/collections/topic', 'PUT', form)).status, 400);
    const old = beforeVersions.find((v) => v.revision === 1);
    assert.ok(old);
    assert.equal(
      (await api('/collections/topic/versions/' + old.id + '/restore', 'POST', { revision: 2 }))
        .status,
      400,
    );
    const restored = (
      await api('/collections/topic/versions/' + old.id + '/restore', 'POST', {
        revision: 2,
        confirm: '恢复专题版本',
      })
    ).data;
    assert.equal(restored.content, saved.content);
    assert.equal(restored.revision, 3);
    await api('/collections/topic/resources', 'POST', { action: 'remove', ids: [entries[0].id] });
    assert.equal((await api('/entries/' + entries[0].id)).data.collections.length, 1);
    assert.equal((await api('/entries')).data.total, 4);
    await api('/collections/topic/resources', 'POST', { action: 'add', ids: [entries[0].id] });
    assert.equal((await api('/collections/topic')).data.count, 4);
    const backup = (await api('/backup', 'POST')).data;
    await api('/taxonomy/collections/topic', 'DELETE');
    assert.equal((await api('/entries')).data.total, 4);
    const zip = new FormData();
    zip.append('backup', new Blob([backup]), 'topics.zip');
    zip.append('confirm', '恢复当前知识库');
    assert.equal((await api('/restore', 'POST', zip)).status, 200);
    assert.equal((await api('/collections/topic')).data.content, saved.content);
    assert.equal((await api('/collections/topic/versions')).data.length, 3);
    assert.deepEqual((await api('/drafts/new')).data.form, wform);
    assert.equal((await api('/collections/topic')).data.count, 4);
  } finally {
    await f.close();
  }
});
test('both Providers synthesize only selected related sources, reject invented/title-only citations and retain reviewed versions', async () => {
  for (const provider of ['openai', 'deepseek']) {
    let invalid = false,
      titleOnly = false,
      calls = 0;
    const transport = async (_, options) => {
      calls++;
      const body = JSON.parse(options.body);
      const payload = JSON.parse(
        provider === 'openai' ? body.input[0].content[0].text : body.messages[1].content,
      );
      assert.equal(payload.mode, 'collection');
      assert.equal(payload.sources.length, 3);
      assert.ok(!JSON.stringify(payload).includes('UNSELECTED_PRIVATE'));
      assert.ok(payload.sources.every((s) => !s.note.includes('<h2>') && !Object.hasOwn(s, 'url')));
      const value = topicSuggestion(payload);
      if (titleOnly) value.core[0].sourceIds = [payload.sources.find((s) => !s.hasEvidence).id];
      if (invalid) value.core[0].sourceIds = ['not-selected'];
      return provider === 'openai' ? fixtureResponse(value) : deepSeekFixtureResponse(value);
    };
    const f = await fixture({
      env:
        provider === 'openai'
          ? { OPENAI_API_KEY: fixtureKey }
          : { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: deepSeekFixtureKey },
      transport,
    });
    const { api, entries } = f;
    try {
      const before = (await api('/collections/topic')).data;
      const req = {
        mode: 'collection',
        collectionId: 'topic',
        ids: entries.slice(0, 3).map((e) => e.id),
      };
      const ready = (await api('/ai/suggest', 'POST', req)).data;
      assert.equal(ready.suggestion.status, 'ready');
      assert.equal(calls, 1);
      assert.equal(ready.sources.length, 3);
      assert.deepEqual((await api('/collections/topic')).data, before);
      assert.equal((await api('/collections/topic/versions')).data.length, 0);
      assert.equal((await api('/collections/topic/drafts/ai')).data.id, ready.draftId);
      await api('/collections/topic/drafts/ai', 'PUT', {
        id: ready.draftId,
        reviewTitle: '人工校对的标题',
        review: '人工校对后的稿件',
      });
      assert.equal((await api('/collections/topic/drafts/ai')).data.review, '人工校对后的稿件');
      const reviewZip = new FormData();
      reviewZip.append('backup', new Blob([(await api('/backup', 'POST')).data]), 'review.zip');
      reviewZip.append('confirm', '恢复当前知识库');
      assert.equal((await api('/restore', 'POST', reviewZip)).status, 200);
      assert.equal((await api('/collections/topic/drafts/ai')).data.id, ready.draftId);
      assert.equal((await api('/collections/topic/drafts/ai')).data.review, '人工校对后的稿件');
      assert.deepEqual((await api('/collections/topic')).data, before);
      const content =
        '<h2>综合总结</h2><p>实际观点 <a data-entry-id="' +
        entries[0].id +
        '" href="#">来源</a></p>';
      let saved = (
        await api('/collections/topic', 'PUT', {
          name: before.name,
          introduction: '',
          content,
          revision: 0,
          aiDraftId: ready.draftId,
          adoptMode: 'replace',
        })
      ).data;
      assert.equal(saved.sources.length, 3);
      assert.ok(saved.content.includes('data-entry-id'));
      assert.equal((await api('/collections/topic/drafts/ai')).data, null);
      saveEntry(
        f.store.getDb(),
        {
          ...fixtureForm,
          title: '来源的新标题',
          url: entries[0].url,
          collections: ['topic', 'other'],
          domains: ['code'],
        },
        entries[0].id,
      );
      const revised = (await api('/ai/suggest', 'POST', req)).data;
      saved = (
        await api('/collections/topic', 'PUT', {
          name: before.name,
          introduction: '',
          content,
          revision: saved.revision,
          aiDraftId: revised.draftId,
          adoptMode: 'append',
        })
      ).data;
      assert.equal(saved.sources.find((s) => s.id === entries[0].id).title, '来源的新标题');
      const previous = (await api('/collections/topic/versions')).data[0];
      assert.equal(
        (await api('/collections/topic/versions/' + previous.id)).data.sources.find(
          (s) => s.id === entries[0].id,
        ).title,
        entries[0].title,
      );
      invalid = true;
      assert.equal((await api('/ai/suggest', 'POST', req)).data.code, 'invalid_output');
      assert.equal((await api('/collections/topic')).data.content, saved.content);
      titleOnly = true;
      saveEntry(
        f.store.getDb(),
        {
          ...fixtureForm,
          title: entries[2].title,
          url: entries[2].url,
          description: '',
          content: '',
          collections: ['topic', 'other'],
          domains: ['code'],
        },
        entries[2].id,
      );
      invalid = false;
      assert.equal((await api('/ai/suggest', 'POST', req)).data.code, 'invalid_output');
      titleOnly = false;
      saveEntry(
        f.store.getDb(),
        {
          ...fixtureForm,
          title: entries[2].title,
          url: entries[2].url,
          collections: ['topic', 'other'],
          domains: ['code'],
        },
        entries[2].id,
      );
      invalid = false;
      const next = (await api('/ai/suggest', 'POST', req)).data;
      await api('/collections/topic/resources', 'POST', { action: 'remove', ids: [entries[0].id] });
      assert.equal(
        (
          await api('/collections/topic', 'PUT', {
            name: before.name,
            introduction: '',
            content,
            revision: saved.revision,
            aiDraftId: next.draftId,
            adoptMode: 'replace',
          })
        ).status,
        400,
      );
      assert.equal((await api('/collections/topic')).data.content, saved.content);
      const ledger = JSON.parse(readFileSync(path.join(f.dir, 'ai-usage.json')));
      assert.ok(ledger.records.every((r) => r.mode === 'collection'));
      assert.ok(!JSON.stringify(ledger).includes(entries[0].title));
    } finally {
      await f.close();
    }
  }
});
test('topic AI finishing after a selected source changes preserves the previous review and summary', async () => {
  let release, started;
  const called = new Promise((r) => (started = r));
  let delayed = false;
  const f = await fixture({
    env: { OPENAI_API_KEY: fixtureKey },
    transport: async (_, options) => {
      const payload = JSON.parse(JSON.parse(options.body).input[0].content[0].text);
      if (delayed) {
        started();
        await new Promise((r) => (release = r));
      }
      return fixtureResponse(topicSuggestion(payload));
    },
  });
  try {
    const req = {
      mode: 'collection',
      collectionId: 'topic',
      ids: f.entries.slice(0, 3).map((e) => e.id),
    };
    const initial = (await f.api('/ai/suggest', 'POST', req)).data;
    const before = (await f.api('/collections/topic')).data;
    delayed = true;
    const pending = f.api('/ai/suggest', 'POST', req);
    await called;
    await f.api('/collections/topic/resources', 'POST', { action: 'remove', ids: [req.ids[0]] });
    release();
    assert.equal((await pending).data.code, 'invalid_output');
    assert.equal((await f.api('/collections/topic/drafts/ai')).data.id, initial.draftId);
    assert.equal((await f.api('/collections/topic')).data.content, before.content);
    assert.equal((await f.api('/collections/topic/versions')).data.length, 0);
  } finally {
    release?.();
    await f.close();
  }
});
test('topic AI insufficient/invalid selection/over-budget/timeout/cancel do not alter summary or drafts', async () => {
  let behavior = 'wait',
    calls = 0;
  const transport = async (_, options) => {
    calls++;
    if (behavior === 'error') return new Response('no public secrets', { status: 500 });
    await new Promise((r, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  };
  const f = await fixture({
    env: { OPENAI_API_KEY: fixtureKey, PK_AI_TIMEOUT_MS: '1000' },
    transport,
  });
  const { api, entries } = f;
  try {
    const before = (await api('/collections/topic')).data;
    const req = {
      mode: 'collection',
      collectionId: 'topic',
      ids: entries.slice(0, 3).map((e) => e.id),
    };
    assert.equal(
      (await api('/ai/suggest', 'POST', { ...req, ids: req.ids.slice(0, 2) })).data.code,
      'input',
    );
    assert.equal(
      (await api('/ai/suggest', 'POST', { ...req, ids: [req.ids[0], req.ids[0], req.ids[1]] })).data
        .code,
      'input',
    );
    const original = entries[0];
    saveEntry(
      f.store.getDb(),
      {
        ...fixtureForm,
        type: 'note',
        url: '',
        title: original.title,
        description: '',
        content: '字'.repeat(12001),
        collections: ['topic', 'other'],
        domains: ['code'],
      },
      original.id,
    );
    assert.equal((await api('/ai/suggest', 'POST', req)).data.code, 'input');
    assert.equal(calls, 0);
    for (const e of entries.slice(0, 3))
      saveEntry(
        f.store.getDb(),
        {
          ...fixtureForm,
          title: e.title,
          url: e.url,
          description: '',
          content: '',
          collections: ['topic', 'other'],
          domains: ['code'],
        },
        e.id,
      );
    const insufficient = (await api('/ai/suggest', 'POST', req)).data;
    assert.equal(insufficient.suggestion.status, 'insufficient');
    assert.equal(calls, 0);
    for (const e of entries.slice(0, 3))
      saveEntry(
        f.store.getDb(),
        {
          ...fixtureForm,
          title: e.title,
          url: e.url,
          collections: ['topic', 'other'],
          domains: ['code'],
        },
        e.id,
      );
    assert.equal((await api('/ai/suggest', 'POST', req)).data.code, 'timeout');
    assert.equal(calls, 1);
    behavior = 'error';
    assert.equal((await api('/ai/suggest', 'POST', req)).data.code, 'upstream');
    assert.equal(calls, 2);
    behavior = 'wait';
    const controller = new AbortController();
    const pending = fetch(f.base + '/api/ai/suggest', {
      method: 'POST',
      headers: { 'X-PK-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    for (let n = 0; n < 30 && calls < 3; n++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 3);
    controller.abort();
    await assert.rejects(pending);
    for (let n = 0; n < 30; n++) {
      if (
        JSON.parse(readFileSync(path.join(f.dir, 'ai-usage.json'))).records.at(-1).status ===
        'cancelled'
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(
      JSON.parse(readFileSync(path.join(f.dir, 'ai-usage.json'))).records.at(-1).status,
      'cancelled',
    );
    assert.deepEqual((await api('/collections/topic')).data, before);
    assert.equal((await api('/collections/topic/drafts/ai')).data, null);
    assert.equal((await api('/collections/topic/versions')).data.length, 0);
  } finally {
    await f.close();
  }
});
