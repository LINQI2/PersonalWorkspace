import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app/server/index.js';
import { openStore, saveEntry } from '../app/server/store.js';
import { prepareImport, commitImport } from '../app/server/knowledge/importer.js';
import {
  getRecord,
  listRecords,
  saveRecord,
  transaction,
  moveRecord,
} from '../app/server/knowledge/store.js';
import {
  attach,
  chapterRows,
  owner,
  structuralSuggestions,
} from '../app/server/knowledge/structure.js';
import { prepareKnowledgeInput } from '../app/server/ai/knowledge.js';
import { createAiService } from '../app/server/ai/service.js';
import { createIntegration } from '../app/server/knowledge/integration.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  assertDatabaseSchema,
} from '../app/server/migrations.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { reviewed, commitBody } from './knowledge-fixture.js';
import { readingPackage, knowledgeForm, integrationPlan } from './knowledge-reading-fixture.js';
import { fixtureKey, fixtureResponse, deepSeekFixtureResponse } from './ai-fixture.js';
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-reading-'));
test('corrupt semantic hierarchy refuses startup and genuine ZIP restore without rewriting records', async () => {
  const dir = temp();
  let db = openStore(dir);
  try {
    const imported = importFixture(db),
      a = imported.ids['point-0'],
      b = imported.ids['point-1'];
    db.prepare('UPDATE knowledge_structure SET parent_id=? WHERE entry_id=?').run(b, a);
    db.prepare('UPDATE knowledge_structure SET parent_id=? WHERE entry_id=?').run(a, b);
    const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
      zip = await exportBackup(db, dir);
    assert.throws(() => validateBackup(zip), /循环/);
    db.close();
    assert.throws(() => openStore(dir), /循环/);
    db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('protected integration API: no review mutation, same-snapshot cache, Origin/session, abort/timeout/upstream and no-key manual operation', async () => {
  const dir = temp();
  let behavior = 'valid',
    calls = 0;
  const store = createApp(dir, {
      ai: {
        env: { OPENAI_API_KEY: fixtureKey, PK_AI_TIMEOUT_MS: '1000' },
        transport: async (_url, init) => {
          calls++;
          if (behavior === 'hold')
            await new Promise((_, reject) => {
              init.signal.addEventListener('abort', () => reject(init.signal.reason), {
                once: true,
              });
            });
          if (behavior === 'error')
            return Response.json({ error: { message: fixtureKey } }, { status: 500 });
          const payload = JSON.parse(JSON.parse(init.body).input[0].content[0].text);
          return fixtureResponse(integrationPlan(payload.sources));
        },
      },
    }),
    db = store.getDb(),
    imported = importFixture(db),
    ids = [imported.ids['point-0'], imported.ids['point-1']],
    before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const session = await (
      await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
    ).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-PK-Request': '1',
      Origin: base,
      'X-PK-Session': session.token,
    };
    const post = (path, body, extra = {}) =>
      fetch(base + '/api/knowledge/integration/' + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...extra,
      });
    const bad = await post(
      'generate',
      { ids },
      { headers: { ...headers, Origin: 'http://evil.test' } },
    );
    assert.equal(bad.status, 403);
    const missing = await post(
      'generate',
      { ids },
      { headers: { ...headers, 'X-PK-Session': '' } },
    );
    assert.equal(missing.status, 403);
    assert.equal(calls, 0);
    const first = await (await post('generate', { ids })).json();
    assert.ok(first.token);
    const second = await (await post('generate', { ids })).json();
    assert.equal(second.fromCache, true);
    assert.equal(calls, 1);
    assert.equal(second.usage, null);
    await post('cancel', { token: first.token });
    const cancelledReview = await post('apply', {
      token: first.token,
      confirm: '采用所选整合建议',
    });
    assert.equal(cancelledReview.status, 400);
    behavior = 'hold';
    const controller = new AbortController();
    const pending = post('generate', { ids: [...ids].reverse() }, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await assert.rejects(() => pending);
    await new Promise((r) => setTimeout(r, 50));
    const timed = await post('generate', { ids: [...ids].reverse() });
    assert.equal((await timed.json()).error.includes('超时'), true);
    behavior = 'error';
    const failed = await post('generate', { ids: [...ids].reverse() });
    const text = await failed.text();
    assert.equal(text.includes(fixtureKey), false);
    assert.equal(failed.status, 400);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
    const ledger = JSON.parse(readFileSync(path.join(dir, 'ai-usage.json')));
    assert.ok(ledger.records.some((r) => r.status === 'cancelled'));
    assert.ok(ledger.records.some((r) => r.status === 'timeout'));
    assert.equal(JSON.stringify(ledger).includes(fixtureKey), false);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const noKeyDir = temp(),
    manual = openStore(noKeyDir);
  try {
    const r = saveRecord(manual, knowledgeForm('离线手工记录'));
    const service = createAiService(noKeyDir, () => manual, {
      env: {},
      transport: () => {
        throw Error('forbidden');
      },
    });
    assert.equal(service.status().configured, false);
    assert.equal(getRecord(manual, r.id).title, '离线手工记录');
  } finally {
    manual.close();
    rmSync(noKeyDir, { recursive: true, force: true });
  }
});
function importFixture(db) {
  const raw = readingPackage(),
    p = prepareImport(db, JSON.stringify(raw));
  return commitImport(db, p.prepared, {
    ...commitBody(p.preview),
    items: reviewed(p.preview).map((i) => ({
      ...i,
      parent: raw.items.find((r) => r.id === i.id).parent || null,
    })),
    approvedDirectories: ['research'],
    organize: true,
  });
}
test('explicit page hierarchy: 1 page/9 points, safe collection, nested cycle rejection, search owner, order persistence and real ZIP', async () => {
  const dir = temp();
  let db = openStore(dir);
  try {
    const imported = importFixture(db),
      page = imported.ids.page;
    assert.equal(listRecords(db).total, 1);
    assert.equal(chapterRows(db, page).length, 9);
    assert.equal(owner(db, imported.ids['point-8']), page);
    const r = getRecord(db, imported.ids['point-0']),
      before = JSON.stringify([r.id, r.content, r.sources, r.original_date]);
    assert.equal(listRecords(db, { q: '独特关键词章节1' }).items[0].page_id, page);
    assert.throws(
      () =>
        transaction(db, () =>
          attach(db, {
            items: [{ id: imported.ids['point-7'], parent_id: imported.ids['point-8'] }],
          }),
        ),
      /循环/,
    );
    moveRecord(db, r.id, 1);
    assert.equal(chapterRows(db, page)[1].id, r.id);
    assert.equal(
      JSON.stringify([
        getRecord(db, r.id).id,
        getRecord(db, r.id).content,
        getRecord(db, r.id).sources,
        getRecord(db, r.id).original_date,
      ]),
      before,
    );
    const extra = saveRecord(db, knowledgeForm('独立旧点'));
    const oldBody = extra.content;
    transaction(db, () =>
      attach(db, { items: [{ id: extra.id, parent_id: page, revision: extra.revision }] }),
    );
    assert.equal(getRecord(db, extra.id).content, oldBody);
    assert.equal(getRecord(db, extra.id).id, extra.id);
    const bytes = await exportBackup(db, dir),
      checked = validateBackup(bytes);
    try {
      const restored = openStore(checked.tmp);
      assert.equal(chapterRows(restored, page).length, 10);
      assert.equal(chapterRows(restored, page)[1].id, r.id);
      assert.equal(getRecord(restored, r.id).content, r.content);
      restored.close();
    } finally {
      checked.dispose();
    }
    db.close();
    db = openStore(dir);
    assert.equal(chapterRows(db, page)[1].id, r.id);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('legacy v1 import parent remains suggestion until reviewed; hierarchy change and partial import are transactional; history preserves HTML', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const p = prepareImport(db, JSON.stringify(readingPackage()));
    const legacy = commitImport(db, p.prepared, {
      ...commitBody(p.preview),
      approvedDirectories: ['research'],
    });
    const page = legacy.ids.page;
    assert.equal(chapterRows(db, page).length, 0);
    assert.equal(structuralSuggestions(db, page).length, 9);
    transaction(db, () => attach(db, { items: structuralSuggestions(db, page) }));
    assert.equal(chapterRows(db, page).length, 9);
    const point = getRecord(db, legacy.ids['point-0']);
    saveRecord(
      db,
      { ...point, title: '新版', references: [], domains: [], tags: [], collections: [] },
      point.id,
    );
    assert.equal(
      db.prepare('SELECT content FROM knowledge_versions WHERE entry_id=?').get(point.id).content,
      point.content,
    );
    const r = getRecord(db, point.id);
    saveEntry(db, { ...r, title: '旧编辑器新版', domains: [], tags: [], collections: [] }, r.id);
    assert.equal(
      db.prepare('SELECT count(*) n FROM knowledge_versions WHERE entry_id=?').get(r.id).n,
      2,
    );
    const n = db.prepare('SELECT count(*) n FROM entries').get().n;
    assert.throws(
      () =>
        commitImport(db, p.prepared, {
          ...commitBody(p.preview),
          repeat: '另存所选知识',
          approvedDirectories: ['research'],
          items: reviewed(p.preview)
            .filter((i) => i.kind !== 'page')
            .map((i) => ({ ...i, parent: 'page' })),
          organize: true,
        }),
      /父级未选中/,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, n);
    const chain = Array.from({ length: 7 }, (_, i) => legacy.ids['point-' + i]);
    transaction(db, () =>
      attach(db, { items: chain.map((id, i) => ({ id, parent_id: i ? chain[i - 1] : page })) }),
    );
    assert.equal(owner(db, chain[6]), page);
    const extra = saveRecord(db, knowledgeForm('超过八层的独立点'));
    assert.throws(
      () => transaction(db, () => attach(db, { items: [{ id: extra.id, parent_id: chain[6] }] })),
      /超过 8 层/,
    );
    assert.equal(owner(db, extra.id), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('selected integration both Providers mock: scoped evidence, editable partial review, untouched originals, snapshot invalidation, invalid citations/bounds', async () => {
  for (const provider of ['openai', 'deepseek']) {
    const dir = temp(),
      db = openStore(dir);
    let responseMode = 'valid',
      calls = 0;
    const ai = createAiService(dir, () => db, {
        env:
          provider === 'openai'
            ? { OPENAI_API_KEY: fixtureKey }
            : { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
        transport: async (_url, init) => {
          calls++;
          const request = JSON.parse(init.body),
            payload = JSON.parse(
              provider === 'openai'
                ? request.input[0].content[0].text
                : request.messages[1].content,
            );
          const value = integrationPlan(payload.sources);
          if (responseMode === 'invalid') value.sections[0].sourceIds = ['unknown'];
          if (responseMode === 'quote') value.relations[0].fromQuote = '模型捏造依据';
          return provider === 'openai' ? fixtureResponse(value) : deepSeekFixtureResponse(value);
        },
      }),
      service = createIntegration(() => db, ai, { cacheResults: false });
    try {
      const imported = importFixture(db),
        page = imported.ids.page,
        ids = [imported.ids['point-0'], imported.ids['point-1']];
      const before = JSON.stringify(ids.map((id) => getRecord(db, id)));
      assert.equal(service.estimate({ ids }).estimatedTokens > 0, true);
      const draft = await service.generate({ ids });
      assert.equal(JSON.stringify(ids.map((id) => getRecord(db, id))), before);
      draft.suggestion.sections[0].title = '人工修改标题';
      service.apply({
        token: draft.token,
        plan: draft.suggestion,
        pageId: page,
        sections: [0],
        relations: [0],
        adoptOrder: false,
        confirm: '采用所选整合建议',
      });
      assert.equal(
        JSON.stringify(
          ids.map((id) => {
            const r = getRecord(db, id);
            r.relations = [];
            r.provenance.relations = [];
            return r;
          }),
        ),
        JSON.stringify(
          ids.map((id) => {
            const r = JSON.parse(before)[ids.indexOf(id)];
            r.relations = [];
            r.provenance.relations = [];
            return r;
          }),
        ),
      );
      const created = db.prepare("SELECT e.id FROM entries e WHERE title='人工修改标题'").get().id;
      assert.equal(getRecord(db, created).status, 'review');
      assert.equal(getRecord(db, created).epistemic, 'ai_inference');
      assert.equal(getRecord(db, created).sources.length, 2);
      const b = await exportBackup(db, dir);
      const v = validateBackup(b);
      v.dispose();
      responseMode = 'invalid';
      await assert.rejects(() => service.generate({ ids }), /不符合/);
      responseMode = 'quote';
      await assert.rejects(() => service.generate({ ids }), /不符合/);
      responseMode = 'valid';
      const stale = await service.generate({ ids }),
        r = getRecord(db, ids[0]);
      saveRecord(
        db,
        {
          ...r,
          content: '<p>修改后正文</p>',
          references: [],
          domains: [],
          tags: [],
          collections: [],
        },
        r.id,
      );
      assert.throws(
        () =>
          service.apply({
            token: stale.token,
            plan: stale.suggestion,
            pageId: page,
            sections: [0],
            relations: [],
            confirm: '采用所选整合建议',
          }),
        /变化/,
      );
      const long = saveRecord(
        db,
        knowledgeForm('长资料', { content: '<p>' + '正文'.repeat(6500) + '</p>' }),
      );
      assert.throws(() => prepareKnowledgeInput(db, { ids: [long.id, ids[1]] }), /过长/);
      const short = saveRecord(db, knowledgeForm('标题', { description: '', content: '' }));
      const beforeCalls = calls;
      const insufficient = await service.generate({ ids: [short.id, ids[0]] });
      assert.equal(insufficient.suggestion.status, 'insufficient');
      assert.equal(calls, beforeCalls);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('schema4 -> 5 preserves all imported knowledge and verifies real pre-upgrade ZIP; fault leaves schema4', async () => {
  for (const fail of [false, true]) {
    const dir = temp();
    mkdirSync(path.join(dir, 'attachments'));
    let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    try {
      db.exec(baseSchema);
      db.exec(topicSchema + toolSchema + knowledgeSchema + 'PRAGMA user_version=4');
      saveRecord(db, knowledgeForm('旧知识'));
      const before = JSON.stringify(db.prepare('SELECT * FROM entries').all());
      db.close();
      if (fail)
        assert.throws(() =>
          openStore(dir, {
            beforeMigrationCommit: () => {
              throw Error('fault');
            },
          }),
        );
      db = fail ? new DatabaseSync(path.join(dir, 'library.sqlite')) : openStore(dir);
      assertDatabaseSchema(db, fail ? 4 : 12);
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries').all()), before);
      const zip = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-5'));
      assert.ok(zip);
      const v = validateBackup(readFileSync(path.join(dir, 'backups', zip)));
      try {
        const d = openStore(v.tmp);
        assert.equal(JSON.stringify(d.prepare('SELECT * FROM entries').all()), before);
        d.close();
      } finally {
        v.dispose();
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
