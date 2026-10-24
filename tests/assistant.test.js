import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, saveEntry } from '../app/server/store.js';
import { createAiService } from '../app/server/ai/service.js';
import { createApp } from '../app/server/index.js';
import {
  createAssistantReview,
  applyOperation,
  reviewTables,
} from '../app/server/assistant/review.js';
import { retrieve, inspect, scope } from '../app/server/assistant/catalog.js';
import { transaction, getRecord, saveRecord } from '../app/server/knowledge/store.js';
import { createIntegration } from '../app/server/knowledge/integration.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  readingSchema,
  assertDatabaseSchema,
  assistantSchema,
} from '../app/server/migrations.js';
import { fixtureKey, fixtureResponse, deepSeekFixtureResponse } from './ai-fixture.js';
import { assistantFixture, assistantResponse } from './assistant-fixture.js';
import { readWorkspace, writeWorkspace } from '../app/server/workspace.js';
function openLegacyReview(dir) {
  mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'library.sqlite'));
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(baseSchema);
  db.exec(
    topicSchema +
      toolSchema +
      knowledgeSchema +
      readingSchema +
      assistantSchema +
      'PRAGMA user_version=6;',
  );
  return db;
}
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-assistant-'));
test('directory merge preserves children and knowledge UUIDs, restores original hierarchy without cascading source loss', async () => {
  const dir = temp(),
    db = openLegacyReview(dir);
  try {
    const f = assistantFixture(db),
      ai = model(dir, db, 'openai', assistantResponse),
      service = createAssistantReview(() => db, ai, dir),
      before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
    const input = await reviewed(
        service,
        ['directories:' + f.root.id, 'directories:' + f.other.id],
        [op('merge', 'directories', 'directories:' + f.root.id, 'directories:' + f.other.id)],
      ),
      out = service.apply(input);
    assert.equal(
      db.prepare('SELECT id FROM knowledge_directories WHERE id=?').get(f.root.id),
      undefined,
    );
    assert.equal(getRecord(db, f.a.id).directory_id, f.other.id);
    assert.equal(
      db.prepare('SELECT parent_id FROM knowledge_directories WHERE id=?').get(f.child.id)
        .parent_id,
      f.other.id,
    );
    service.restore({ id: out.id, confirm: '恢复结构变更' });
    assert.equal(getRecord(db, f.a.id).directory_id, f.root.id);
    assert.equal(
      db.prepare('SELECT parent_id FROM knowledge_directories WHERE id=?').get(f.child.id)
        .parent_id,
      f.root.id,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_entry_sources').get().n, 1);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
    const next = service.apply(
      await reviewed(
        service,
        ['directories:' + f.root.id],
        [op('rename', 'directories', 'directories:' + f.root.id, '', '待验证目录')],
      ),
    );
    writeWorkspace(dir, { ...readWorkspace(dir), preferences: { layout: 'list', sort: 'recent' } });
    assert.throws(() => service.restore({ id: next.id, confirm: '恢复结构变更' }), /已变化/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('assistant API rejects CSRF/session, invalid modes/length/citations; cancellation, timeout, missing key and errors never alter originals', async () => {
  const dir = temp();
  let behavior = 'hold',
    calls = 0;
  const store = createApp(dir, {
      ai: {
        env: { OPENAI_API_KEY: fixtureKey, PK_AI_TIMEOUT_MS: '1000' },
        transport: async (_url, init) => {
          calls++;
          if (behavior === 'hold')
            await new Promise((_, reject) =>
              init.signal.addEventListener('abort', () => reject(init.signal.reason), {
                once: true,
              }),
            );
          if (behavior === 'error')
            return Response.json({ error: { message: fixtureKey } }, { status: 500 });
          const payload = JSON.parse(JSON.parse(init.body).input[0].content[0].text);
          const value = assistantResponse(payload);
          value.answer[0].sourceIds = ['entries:fake'];
          return fixtureResponse(value);
        },
      },
    }),
    db = store.getDb(),
    f = assistantFixture(db),
    before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const s = await (
        await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json(),
      headers = {
        'X-PK-Request': '1',
        'X-PK-Session': s.token,
        Origin: base,
        'Content-Type': 'application/json',
      },
      body = { mode: 'assistant_qa', question: '实验观察', keys: ['entries:' + f.a.id] },
      post = (path, body, extra = {}) =>
        fetch(base + '/api/assistant/' + path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...extra,
        });
    assert.equal(
      (await post('generate', body, { headers: { ...headers, Origin: 'http://evil.test' } }))
        .status,
      403,
    );
    assert.equal(
      (await post('generate', body, { headers: { ...headers, 'X-PK-Session': '' } })).status,
      403,
    );
    assert.equal((await post('generate', { ...body, mode: 'connection' })).status, 400);
    assert.equal((await post('generate', { ...body, question: '长'.repeat(1001) })).status, 400);
    assert.equal(calls, 0);
    const c = new AbortController(),
      pending = post('generate', body, { signal: c.signal });
    await new Promise((r) => setTimeout(r, 100));
    c.abort();
    await assert.rejects(() => pending);
    await new Promise((r) => setTimeout(r, 60));
    const timeout = await post('generate', body);
    assert.ok((await timeout.json()).error.includes('超时'));
    behavior = 'error';
    const err = await post('generate', body);
    assert.equal((await err.text()).includes(fixtureKey), false);
    behavior = 'invalid';
    assert.equal((await post('generate', body)).status, 400);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
    const usage = JSON.parse(readFileSync(path.join(dir, 'ai-usage.json')));
    assert.ok(usage.records.every((r) => r.mode === 'assistant_qa'));
    assert.ok(usage.records.some((r) => r.status === 'cancelled'));
    assert.ok(usage.records.some((r) => r.status === 'timeout'));
    assert.equal(JSON.stringify(usage).includes(fixtureKey), false);
    const ai = createAiService(dir, () => db, {
      env: {},
      transport: () => {
        throw Error('forbidden');
      },
    });
    await assert.rejects(() => createAssistantReview(() => db, ai, dir).generate(body), /尚未配置/);
    assert.ok(db.prepare('SELECT id FROM entries WHERE id=?').get(f.a.id));
    const long = getRecord(db, f.a.id);
    saveRecord(
      db,
      {
        ...long,
        description: '文'.repeat(2000),
        content: '<p>' + '长资料'.repeat(5000) + '</p>',
        domains: [],
        tags: [],
        collections: [],
        references: [],
      },
      long.id,
    );
    const size = await post('estimate', body);
    assert.equal(size.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('tampered structure history HTML refuses genuine backup and startup; original knowledge preserved', async () => {
  const dir = temp();
  let db = openLegacyReview(dir);
  try {
    const f = assistantFixture(db),
      ai = model(dir, db, 'openai', assistantResponse),
      service = createAssistantReview(() => db, ai, dir);
    const input = await reviewed(
        service,
        ['directories:' + f.root.id],
        [op('rename', 'directories', 'directories:' + f.root.id, '', '研究资料')],
      ),
      change = service.apply(input),
      r = db.prepare('SELECT before_json FROM assistant_changes WHERE id=?').get(change.id),
      bad = JSON.parse(r.before_json);
    bad.collection_documents[0].content = '<script>bad()</script>';
    db.prepare('UPDATE assistant_changes SET before_json=? WHERE id=?').run(
      JSON.stringify(bad),
      change.id,
    );
    const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
      zip = await exportBackup(db, dir);
    assert.throws(() => validateBackup(zip), /正文不安全/);
    db.close();
    assert.throws(() => openStore(dir), /正文不安全/);
    db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
const op = (action, kind, object, target = '', name = '') => ({
  action,
  kind,
  object,
  target,
  name,
  reason: '合成审核理由，需人工核对。',
  evidenceIds: [object || target].filter(Boolean),
});
const model = (dir, db, provider, getValue) =>
  createAiService(dir, () => db, {
    env:
      provider === 'deepseek'
        ? { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey }
        : { OPENAI_API_KEY: fixtureKey },
    transport: async (_url, init) => {
      const request = JSON.parse(init.body),
        payload = JSON.parse(
          provider === 'deepseek' ? request.messages[1].content : request.input[0].content[0].text,
        );
      const value = getValue(payload);
      return provider === 'deepseek' ? deepSeekFixtureResponse(value) : fixtureResponse(value);
    },
  });
async function reviewed(service, keys, suggestions) {
  const generated = await service.generate({ mode: 'assistant_structure', keys });
  const plan = { status: 'ready', suggestions, missing: [] },
    selected = suggestions.map((_, i) => i),
    preview = service.preview({ token: generated.token, plan, selected });
  return {
    token: generated.token,
    plan,
    selected,
    ...preview,
    confirm: '采用结构变更',
    mergeConfirm: '合并分类并保留引用',
  };
}
test('SQLite evidence retrieval covers entries/tools/pages/points/topics/directories and no match/title-only cannot invent citations; both Providers mock', async () => {
  for (const provider of ['openai', 'deepseek']) {
    const dir = temp(),
      db = openStore(dir);
    let invalid = false,
      calls = 0;
    try {
      const f = assistantFixture(db),
        before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
      const found = retrieve(db, '实验');
      assert.ok(found.items.some((s) => s.id === f.tool.id));
      assert.ok(found.items.some((s) => s.id === f.a.id));
      assert.ok(found.items.some((s) => s.key === 'collections:topic-a'));
      assert.equal(found.items.find((s) => s.id === f.bare.id).hasEvidence, false);
      assert.equal(retrieve(db, '没有此独特匹配zz987').items.length, 0);
      const ai = model(dir, db, provider, (p) => {
        calls++;
        const v = assistantResponse(p);
        if (invalid) v.answer[0].sourceIds = ['entries:fake'];
        return v;
      });
      const service = createAssistantReview(() => db, ai, dir);
      let r = await service.generate({
        mode: 'assistant_qa',
        question: '实验观察是什么',
        keys: ['entries:' + f.a.id, 'collections:topic-a'],
      });
      assert.equal(r.suggestion.answer[0].basis, 'evidence');
      assert.equal(r.suggestion.answer[1].basis, 'inference');
      assert.equal(r.sources.length, 2);
      const n = calls;
      r = await service.generate({
        mode: 'assistant_qa',
        question: '内容是什么',
        keys: ['entries:' + f.bare.id],
      });
      assert.equal(r.suggestion.status, 'insufficient');
      assert.equal(calls, n);
      r = await service.generate({ mode: 'assistant_qa', question: '未知资料', keys: [] });
      assert.equal(r.suggestion.status, 'insufficient');
      invalid = true;
      await assert.rejects(
        () =>
          service.generate({
            mode: 'assistant_qa',
            question: '实验观察',
            keys: ['entries:' + f.a.id],
          }),
        /不符合/,
      );
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
      assert.equal(
        readFileSync(path.join(dir, 'ai-usage.json'), 'utf8').includes(fixtureKey),
        false,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('review rename/move/merge/associate/create preserves UUID/body/source/date and true many-to-many; real ZIP and exact history restore', async () => {
  const dir = temp(),
    db = openLegacyReview(dir);
  try {
    const f = assistantFixture(db),
      before = Object.fromEntries(
        reviewTables.map((t) => [t, db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()]),
      ),
      entryBefore = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
      sourcesBefore = JSON.stringify(
        db.prepare('SELECT * FROM knowledge_entry_sources ORDER BY entry_id').all(),
      );
    const local = inspect(db);
    assert.ok(local.candidates.some((c) => c.action === 'merge'));
    const ai = model(dir, db, 'openai', assistantResponse),
      service = createAssistantReview(() => db, ai, dir);
    const keys = [
      'directories:' + f.root.id,
      'directories:' + f.other.id,
      'directories:' + f.child.id,
      'tags:tag-a',
      'tags:tag-b',
      'domains:domain-a',
      'domains:domain-b',
      'collections:topic-a',
      'collections:topic-b',
      'entries:' + f.a.id,
    ];
    const suggestions = [
      op('rename', 'directories', 'directories:' + f.root.id, '', '研究实验'),
      op('move', 'directories', 'directories:' + f.child.id, 'directories:' + f.other.id),
      op('merge', 'tags', 'tags:tag-a', 'tags:tag-b'),
      op('merge', 'domains', 'domains:domain-a', 'domains:domain-b'),
      op('merge', 'collections', 'collections:topic-a', 'collections:topic-b'),
      op('associate', 'entries', 'entries:' + f.a.id, 'tags:tag-b'),
      op('create', 'directories', '', 'directories:' + f.root.id, '新实验分组'),
    ];
    const input = await reviewed(service, keys, suggestions);
    const changed = service.apply(input);
    assert.equal(
      db.prepare('SELECT name FROM knowledge_directories WHERE id=?').get(f.root.id).name,
      '研究实验',
    );
    assert.equal(
      db.prepare('SELECT parent_id FROM knowledge_directories WHERE id=?').get(f.child.id)
        .parent_id,
      f.other.id,
    );
    assert.equal(
      db.prepare('SELECT count(*) n FROM entry_tags WHERE taxonomy_id=?').get('tag-b').n,
      2,
    );
    assert.equal(db.prepare('SELECT id FROM tags WHERE id=?').get('tag-a'), undefined);
    assert.equal(
      db.prepare('SELECT count(*) n FROM entry_collections WHERE taxonomy_id=?').get('topic-b').n,
      2,
    );
    const summary = db
      .prepare('SELECT content FROM collection_documents WHERE collection_id=?')
      .get('topic-b').content;
    assert.ok(summary.includes('原专题知识总结') && summary.includes('目标专题判断保留'));
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
      entryBefore,
    );
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM knowledge_entry_sources ORDER BY entry_id').all()),
      sourcesBefore,
    );
    const checked = validateBackup(await exportBackup(db, dir));
    try {
      const d = openStore(checked.tmp),
        restore = createAssistantReview(() => d, ai, checked.tmp);
      assert.throws(() => restore.restore({ id: changed.id, confirm: '恢复结构变更' }), /已变化/); // migration changes state; old history cannot overwrite the new schema
      assert.equal(d.prepare('SELECT count(*) n FROM tags').get().n, 1);
      assert.equal(d.prepare('SELECT count(*) n FROM knowledge_entry_sources').get().n, 1);
      d.close();
    } finally {
      checked.dispose();
    }
    service.restore({ id: changed.id, confirm: '恢复结构变更' });
    for (const t of reviewTables) {
      const sort = (rows) => rows.map((r) => JSON.stringify(r)).sort();
      assert.deepEqual(sort(db.prepare('SELECT * FROM ' + t).all()), sort(before[t]), t);
    }
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()),
      entryBefore,
    );
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM knowledge_entry_sources ORDER BY entry_id').all()),
      sourcesBefore,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('review invalidations, changed diffs, cyclic directories, injected failure, drafts and changed-library history refuse without partial mutation', async () => {
  const dir = temp(),
    db = openLegacyReview(dir);
  try {
    const f = assistantFixture(db),
      ai = model(dir, db, 'deepseek', assistantResponse),
      service = createAssistantReview(() => db, ai, dir);
    const keys = [
      'directories:' + f.root.id,
      'directories:' + f.child.id,
      'tags:tag-a',
      'tags:tag-b',
    ];
    const input = await reviewed(service, keys, [
      op('rename', 'directories', 'directories:' + f.root.id, '', '已修改名称'),
    ]);
    input.plan.suggestions[0].name = '绕过差异';
    assert.throws(() => service.apply(input), /状态已变化/);
    input.plan.suggestions[0].name = '已修改名称';
    db.prepare('UPDATE tags SET name=? WHERE id=?').run('新标签内容', 'tag-b');
    assert.throws(() => service.apply(input), /变化/);
    const loop = await reviewed(service, keys, [
      op('move', 'directories', 'directories:' + f.root.id, 'directories:' + f.child.id),
    ]);
    assert.throws(() => service.apply(loop), /循环/);
    assert.equal(
      db.prepare('SELECT parent_id FROM knowledge_directories WHERE id=?').get(f.root.id).parent_id,
      null,
    );
    const fault = createAssistantReview(() => db, ai, dir, {
      beforeCommit: () => {
        throw Error('fault');
      },
    });
    const doomed = await reviewed(fault, keys, [
      op('rename', 'directories', 'directories:' + f.root.id, '', '故障前名字'),
    ]);
    assert.throws(() => fault.apply(doomed), /fault/);
    assert.equal(
      db.prepare('SELECT name FROM knowledge_directories WHERE id=?').get(f.root.id).name,
      '研究目录',
    );
    const applied = service.apply(
      await reviewed(service, keys, [
        op('rename', 'directories', 'directories:' + f.root.id, '', '保存名称'),
      ]),
    );
    db.prepare('UPDATE entries SET description=? WHERE id=?').run('其他用户新增资料', f.a.id);
    assert.throws(() => service.restore({ id: applied.id, confirm: '恢复结构变更' }), /已变化/);
    db.prepare('INSERT INTO collection_drafts VALUES(?,?,?,?,?)').run(
      'topic-a',
      'manual',
      '{}',
      1,
      new Date().toISOString(),
    );
    assert.throws(
      () =>
        transaction(db, () =>
          applyOperation(
            db,
            dir,
            op('merge', 'collections', 'collections:topic-a', 'collections:topic-b'),
          ),
        ),
      /草稿/,
    );
    assert.ok(db.prepare('SELECT id FROM collections WHERE id=?').get('topic-a'));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('cross-directory scope and new comprehensive page retain different stages, provenance and originals, with transaction rollback', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const f = assistantFixture(db),
      before = JSON.stringify([getRecord(db, f.a.id), getRecord(db, f.b.id)]),
      expanded = scope(db, { keys: ['directories:' + f.root.id, 'directories:' + f.other.id] });
    assert.ok(
      expanded.items.some((r) => r.id === f.a.id) && expanded.items.some((r) => r.id === f.b.id),
    );
    const ai = model(dir, db, 'deepseek', (p) => {
        assert.equal(p.sources[0].originalDate, '2026-09-01');
        assert.equal(p.sources[1].originalDate, '2026-09-20');
        return assistantResponse(p);
      }),
      service = createIntegration(() => db, ai);
    const generated = await service.generate({ ids: [f.a.id, f.b.id] });
    const adopted = service.apply({
      token: generated.token,
      plan: generated.suggestion,
      sections: [0],
      relations: [],
      newPage: { title: '综合研究页', directory_id: f.root.id },
      confirm: '采用所选整合建议',
    });
    assert.equal(getRecord(db, adopted.pageId).kind, 'page');
    assert.equal(getRecord(db, adopted.created[0]).status, 'review');
    const preservedSources = getRecord(db, adopted.created[0]).sources;
    assert.equal(
      preservedSources.find((s) => s.title.includes(f.a.id)).original_date,
      '2026-09-01',
    );
    assert.equal(
      preservedSources.find((s) => s.title.includes(f.b.id)).original_date,
      '2026-09-20',
    );
    const original = JSON.parse(before);
    for (let i = 0; i < 2; i++) {
      const now = getRecord(db, original[i].id);
      now.relations = original[i].relations;
      now.provenance.relations = original[i].provenance.relations;
      assert.equal(JSON.stringify(now), JSON.stringify(original[i]));
    }
    const zip = validateBackup(await exportBackup(db, dir));
    zip.dispose();
    const stale = await service.generate({ ids: [f.a.id, f.b.id], pageId: f.page.id });
    const page = getRecord(db, f.page.id);
    saveRecord(
      db,
      {
        ...page,
        content: '<p>另一个用户修改了页面概览</p>',
        references: [],
        domains: [],
        tags: [],
        collections: [],
      },
      page.id,
    );
    assert.throws(
      () =>
        service.apply({
          token: stale.token,
          plan: stale.suggestion,
          sections: [0],
          relations: [],
          pageId: f.page.id,
          confirm: '采用所选整合建议',
        }),
      /目标页面/,
    );
    const failed = await service.generate({ ids: [f.a.id, f.b.id] }),
      count = db.prepare('SELECT count(*) n FROM entries').get().n,
      sourceCount = db.prepare('SELECT count(*) n FROM knowledge_sources').get().n;
    assert.throws(
      () =>
        service.apply({
          token: failed.token,
          plan: failed.suggestion,
          sections: [0],
          relations: [],
          newPage: { title: '应回滚的综合页面' },
          adoptOrder: true,
          confirm: '采用所选整合建议',
        }),
      /直属章节/,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, count);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_sources').get().n, sourceCount);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema5 ->6 exact old data/pre-upgrade ZIP; migration fault preserves5', async () => {
  for (const fail of [false, true]) {
    const dir = temp();
    mkdirSync(path.join(dir, 'attachments'));
    let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    try {
      db.exec(baseSchema);
      db.exec(topicSchema + toolSchema + knowledgeSchema + readingSchema + 'PRAGMA user_version=5');
      assistantFixture(db);
      const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
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
      assertDatabaseSchema(db, fail ? 5 : 11);
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all()), before);
      const file = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-6'));
      const restored = validateBackup(readFileSync(path.join(dir, 'backups', file)));
      const d = openStore(restored.tmp);
      assert.equal(JSON.stringify(d.prepare('SELECT * FROM entries ORDER BY id').all()), before);
      d.close();
      restored.dispose();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
