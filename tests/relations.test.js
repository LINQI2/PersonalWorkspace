import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, saveEntry } from '../app/server/store.js';
import { saveRecord, transaction, moveRecord } from '../app/server/knowledge/store.js';
import { attach, chapterRows } from '../app/server/knowledge/structure.js';
import {
  relationTypes,
  writeRelation,
  changeRelations,
  related,
  edges,
  graph,
  checkDelete,
  reviewRelation,
  restoreRelations,
  candidates,
} from '../app/server/relations.js';
import { createRelationReview } from '../app/server/ai/relations.js';
import { createAiService } from '../app/server/ai/service.js';
import { fixtureKey, fixtureResponse, deepSeekFixtureResponse } from './ai-fixture.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  readingSchema,
  assistantSchema,
  unifiedSchema,
  assertDatabaseSchema,
} from '../app/server/migrations.js';
import { prepareImport, commitImport } from '../app/server/knowledge/importer.js';
import { createApp } from '../app/server/index.js';
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-relations-'));
const form = (title) => ({
  type: 'note',
  resource_kind: 'knowledge',
  tool_kind: '',
  title,
  url: '',
  description: '',
  content: '<p>这是可核对的合成实验记录。保留不同观点、原始日期与未确定结论。</p>',
  cover_asset_id: null,
  pinned: 0,
  domains: [],
  tags: [],
  collections: [],
});
function fixture(db) {
  const a = saveEntry(db, form('实验甲')),
    b = saveEntry(db, form('实验乙')),
    c = saveEntry(db, form('实验丙'));
  return { a, b, c };
}
const rel = (a, b, type = 'reference') => ({
  from_id: a.id,
  to_id: b.id,
  type,
  note: '合成关联声明，人工核对依据',
  evidence: [],
  uncertainty: '未作事实验证',
});
const state = (db) =>
  JSON.stringify([
    db.prepare('SELECT * FROM knowledge_relations ORDER BY id').all(),
    db.prepare('SELECT * FROM relation_details ORDER BY relation_id').all(),
    db.prepare('SELECT * FROM relation_history ORDER BY id').all(),
  ]);
test('all seven types have real forward/backlink endpoints, manual/AI/import origin and explicit confirmation; duplicates/self/missing refuse', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const { a, b } = fixture(db);
    for (const type of relationTypes) changeRelations(db, () => writeRelation(db, rel(a, b, type)));
    assert.equal(related(db, a.id).length, 7);
    assert.ok(related(db, a.id).every((r) => r.direction === 'outgoing' && r.other.id === b.id));
    assert.ok(related(db, b.id).every((r) => r.direction === 'incoming' && r.other.id === a.id));
    assert.throws(() => changeRelations(db, () => writeRelation(db, rel(a, b))), /已存在/);
    assert.throws(() => changeRelations(db, () => writeRelation(db, rel(a, a))), /自引用/);
    assert.throws(
      () => changeRelations(db, () => writeRelation(db, rel(a, { id: 'none' }))),
      /不存在/,
    );
    assert.throws(
      () => changeRelations(db, () => writeRelation(db, rel(b, a, 'conflict'))),
      /已存在/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('dependency/composition/revision cycles refuse but reciprocal references allowed; edits bind revision and restore transactions', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const { a, b, c } = fixture(db);
    for (const type of ['dependency', 'composition', 'revision']) {
      changeRelations(db, () => writeRelation(db, rel(a, b, type)));
      changeRelations(db, () => writeRelation(db, rel(b, c, type)));
      assert.throws(() => changeRelations(db, () => writeRelation(db, rel(c, a, type))), /循环/);
    }
    changeRelations(db, () => writeRelation(db, rel(a, b)));
    changeRelations(db, () => writeRelation(db, rel(b, a)));
    const before = state(db);
    assert.throws(() =>
      changeRelations(db, () => writeRelation(db, rel(a, c, 'related')), {
        beforeCommit: () => {
          throw Error('disk fault');
        },
      }),
    );
    assert.equal(state(db), before);
    const r = related(db, a.id).find((r) => r.type === 'reference' && r.direction === 'outgoing');
    changeRelations(db, () => writeRelation(db, { ...r, note: '新人工依据' }));
    assert.throws(
      () => changeRelations(db, () => writeRelation(db, { ...r, note: '过期修改' })),
      /已变化/,
    );
    const latest = db.prepare('SELECT id FROM relation_history ORDER BY rowid DESC').get();
    restoreRelations(db, latest.id);
    assert.equal(related(db, a.id).find((x) => x.id === r.id).note, r.note);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('stable chapter anchors survive rename/order; referenced deletion/batch removal refuses; explicit inline and ownership are read-only system relations', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const base = {
      ...form('综合文档'),
      kind: 'page',
      directory_id: null,
      priority: 0,
      status: 'review',
      epistemic: 'ai_inference',
      questions: '',
      references: [],
      original_date: '2025-01-02',
      date_note: '',
    };
    const page = saveRecord(db, base),
      child = saveRecord(db, { ...base, title: '章节', kind: 'point' }),
      other = saveRecord(db, { ...base, title: '另一章', kind: 'point' });
    transaction(db, () =>
      attach(db, {
        items: [
          { id: child.id, parent_id: page.id },
          { id: other.id, parent_id: page.id },
        ],
      }),
    );
    const a = saveEntry(db, form('引用笔记'));
    changeRelations(db, () => writeRelation(db, rel(a, child)));
    const anchor = related(db, a.id)[0].other.anchor;
    moveRecord(db, child.id, 1);
    saveEntry(db, { ...form('改名章节'), content: '<p>正文保留</p>' }, child.id);
    assert.equal(related(db, a.id)[0].other.anchor, anchor);
    assert.equal(related(db, a.id)[0].other.pageId, page.id);
    assert.throws(() => checkDelete(db, [child.id]), /仍有/);
    const typed = related(db, a.id)[0];
    reviewRelation(db, { id: typed.id, action: 'reject' });
    checkDelete(db, [child.id]);
    const body = {
      ...form('正文链接'),
      content: '<p><a data-entry-id="' + child.id + '">明确引用</a></p>',
    };
    const linked = saveEntry(db, body);
    assert.ok(related(db, child.id).some((r) => r.system && r.type === 'reference'));
    assert.throws(() => checkDelete(db, [child.id]), /仍有/);
    saveEntry(db, form('正文链接'), linked.id);
    checkDelete(db, [child.id]);
    db.prepare('DELETE FROM entries WHERE id=?').run(child.id);
    assert.equal(chapterRows(db, page.id).length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('local map one/two layers and filters are bounded true nodes; candidate/manual separation; local domain/topic retrieval', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const { a, b, c } = fixture(db);
    changeRelations(db, () => writeRelation(db, rel(a, b, 'related')));
    changeRelations(db, () => writeRelation(db, rel(b, c, 'conflict')));
    assert.equal(graph(db, { id: a.id, depth: 1, types: [] }).nodes.length, 2);
    assert.equal(graph(db, { id: a.id, depth: 2, types: [] }).nodes.length, 3);
    assert.equal(graph(db, { id: a.id, depth: 2, types: ['reference'] }).nodes.length, 1);
    const d = saveEntry(db, form('候选'));
    changeRelations(db, () =>
      writeRelation(db, rel(a, d, 'reference'), { origin: 'ai', state: 'candidate' }),
    );
    assert.equal(graph(db, { id: a.id, types: [] }).nodes.length, 2);
    assert.equal(graph(db, { id: a.id, types: [], candidates: true }).nodes.length, 3);
    db.prepare('INSERT INTO domains VALUES(?,?)').run('domain', '实验领域');
    db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '实验专题');
    for (const id of [a.id, b.id]) {
      db.prepare('INSERT INTO entry_domains VALUES(?,?)').run(id, 'domain');
      db.prepare('INSERT INTO entry_collections VALUES(?,?)').run(id, 'topic');
    }
    assert.equal(
      candidates(db, { center: a.id, domain: 'domain', collection: 'topic' })[0].id,
      b.id,
    );
    transaction(db, () => {
      for (let i = 0; i < 42; i++) {
        const e = saveEntry(db, form('大量真实节点' + i), undefined, { transaction: false });
        writeRelation(db, rel(a, e));
      }
    });
    const m = graph(db, { id: a.id, depth: 2, types: [] });
    assert.equal(m.nodes.length, 40);
    assert.ok(m.edges.length <= 80 && m.omitted > 0);
    assert.ok(m.nodes.every((n) => db.prepare('SELECT id FROM entries WHERE id=?').get(n.id)));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
const aiPlan = (p) => ({
  status: 'ready',
  suggestions: [
    {
      from_id: p.sources[0].id,
      to_id: p.sources[1].id,
      type: 'conflict',
      note: '两份资料可作冲突候选；不判断谁正确',
      evidence: p.sources.map((s) => ({ id: s.id, quote: s.text.trim().slice(0, 15) })),
      uncertainty: '需要独立核对上下文',
    },
  ],
  missing: [],
});
test('both Providers AI scopes only selected evidence: edit/partial adopt remains candidate, confirm/reject, changed evidence/invalid citations refuse with rollback', async () => {
  for (const provider of ['openai', 'deepseek']) {
    const dir = temp(),
      db = openStore(dir);
    let bad = false,
      calls = 0;
    try {
      const { a, b, c } = fixture(db),
        original = JSON.stringify(db.prepare('SELECT * FROM entries').all());
      const ai = createAiService(dir, () => db, {
          env:
            provider === 'openai'
              ? { OPENAI_API_KEY: fixtureKey }
              : { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
          transport: async (_u, init) => {
            calls++;
            const body = JSON.parse(init.body),
              p = JSON.parse(
                provider === 'openai' ? body.input[0].content[0].text : body.messages[1].content,
              );
            assert.equal(p.sources.length, 2);
            assert.ok(!JSON.stringify(p).includes(c.id));
            const v = aiPlan(p);
            if (bad) v.suggestions[0].evidence[0].quote = '伪造引文';
            return provider === 'openai' ? fixtureResponse(v) : deepSeekFixtureResponse(v);
          },
        }),
        service = createRelationReview(() => db, ai);
      const g = await service.generate({ ids: [a.id, b.id] });
      assert.equal(db.prepare('SELECT count(*) n FROM knowledge_relations').get().n, 0);
      g.suggestion.suggestions[0].note = '人工修改后的候选依据';
      service.apply({ token: g.token, plan: g.suggestion, selected: [0], confirm: '采用关联建议' });
      const r = related(db, a.id)[0];
      assert.equal(r.state, 'candidate');
      assert.equal(r.origin, 'ai');
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries').all()), original);
      reviewRelation(db, { id: r.id, action: 'confirm', confirm: '确认关系' });
      assert.equal(related(db, a.id)[0].state, 'confirmed');
      reviewRelation(db, { id: r.id, action: 'reject' });
      const later = await service.generate({ ids: [a.id, b.id] });
      saveEntry(db, form('已修改源标题'), a.id);
      assert.throws(
        () =>
          service.apply({
            token: later.token,
            plan: later.suggestion,
            selected: [0],
            confirm: '采用关联建议',
          }),
        /已变化/,
      );
      bad = true;
      await assert.rejects(() => service.generate({ ids: [a.id, b.id] }));
      assert.equal(db.prepare('SELECT count(*) n FROM knowledge_relations').get().n, 0);
      assert.ok(calls >= 3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('AI insufficient/oversize/no key/timeout/cancel use shared limits and preserve originals; fault injection rolls back', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const { a, b } = fixture(db),
      plain = saveEntry(db, { ...form('无正文'), content: '', description: '' });
    const noKey = createAiService(dir, () => db, { env: {} }),
      s = createRelationReview(() => db, noKey);
    assert.equal((await s.generate({ ids: [a.id, plain.id] })).suggestion.status, 'insufficient');
    await assert.rejects(() => s.generate({ ids: [a.id, b.id] }));
    saveEntry(db, { ...form('长正文'), content: '<p>' + '长资料'.repeat(5000) + '</p>' }, b.id);
    assert.throws(() => s.estimate({ ids: [a.id, b.id] }));
    saveEntry(db, form('正常正文'), b.id);
    const ai = createAiService(dir, () => db, {
        env: { OPENAI_API_KEY: fixtureKey, PK_AI_TIMEOUT_MS: '1000' },
        transport: async (_u, init) =>
          new Promise((_r, reject) =>
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
          ),
      }),
      service = createRelationReview(() => db, ai);
    await assert.rejects(() => service.generate({ ids: [a.id, b.id] }));
    const controller = new AbortController(),
      p = service.generate({ ids: [a.id, b.id] }, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(() => p);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_relations').get().n, 0);
    assert.ok(JSON.parse(readFileSync(path.join(dir, 'ai-usage.json'))).records.length >= 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('compatible JSON v2 relationship extensions remain candidate and true ZIP restores origins/history; history cannot overwrite later content', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const pkg = {
        format: 'personal-knowledge-exchange',
        version: 2,
        sources: [],
        items: [
          { id: 'a', content_type: 'note', title: '甲', body: '原始甲' },
          { id: 'b', content_type: 'note', title: '乙', body: '原始乙' },
        ],
        relations: [{ from: 'a', to: 'b', kind: 'reference', note: '显式关系候选' }],
      },
      p = prepareImport(db, JSON.stringify(pkg), 'json'),
      r = commitImport(db, p.prepared, {
        confirm: '确认导入所选知识',
        items: p.preview.items.map((i) => ({
          id: i.id,
          title: i.title,
          body: i.body,
          body_format: 'plain',
          content_type: 'note',
          domains: [],
          tags: [],
          collections: [],
        })),
        approvedTaxonomy: [],
        approvedDomains: [],
        includeRelations: true,
      });
    assert.equal(related(db, r.ids.a)[0].origin, 'import');
    assert.equal(related(db, r.ids.a)[0].state, 'candidate');
    reviewRelation(db, { id: related(db, r.ids.a)[0].id, action: 'confirm', confirm: '确认关系' });
    const b = validateBackup(await exportBackup(db, dir));
    try {
      const d = openStore(b.tmp);
      assert.equal(related(d, r.ids.b)[0].type, 'reference');
      assert.equal(d.prepare('SELECT count(*) n FROM relation_history').get().n, 1);
      d.close();
    } finally {
      b.dispose();
    }
    const h = db.prepare('SELECT id FROM relation_history').get();
    saveEntry(db, form('后续编辑'), r.ids.a);
    assert.throws(() => restoreRelations(db, h.id), /已变化/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema7 ->8 pre-migration ZIP keeps all old tables, fault stays7 and schema7 backup restores forward', () => {
  for (const fail of [false, true]) {
    const dir = temp();
    mkdirSync(path.join(dir, 'attachments'));
    let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    try {
      db.exec('PRAGMA foreign_keys=ON');
      db.exec(baseSchema);
      db.exec(
        topicSchema +
          toolSchema +
          knowledgeSchema +
          readingSchema +
          assistantSchema +
          unifiedSchema +
          'PRAGMA user_version=7',
      );
      saveEntry(db, form('原笔记'));
      const old = db.prepare('SELECT * FROM entries').all();
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
      assertDatabaseSchema(db, fail ? 7 : 11);
      assert.deepEqual(db.prepare('SELECT * FROM entries').all(), old);
      const zip = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-8'));
      const v = validateBackup(readFileSync(path.join(dir, 'backups', zip)));
      try {
        const d = openStore(v.tmp);
        assertDatabaseSchema(d, 11);
        assert.deepEqual(d.prepare('SELECT * FROM entries').all(), old);
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
test('local API rejects cross-origin/session, bound target IDs, unsafe deletion and malformed histories', async () => {
  const dir = temp(),
    store = createApp(dir, { ai: { env: {} } }),
    db = store.getDb(),
    { a, b } = fixture(db),
    server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const headers = { 'X-PK-Request': '1', Origin: base, 'Content-Type': 'application/json' },
      session = await (await fetch(base + '/api/local/session', { headers })).json(),
      request = (path, body, s = session.token) =>
        fetch(base + '/api/relations/' + path, {
          method: 'POST',
          headers: { ...headers, 'X-PK-Session': s },
          body: JSON.stringify(body),
        });
    assert.equal(
      (await request('save', { ...rel(a, b), confirm: '保存人工关联' }, 'bad')).status,
      403,
    );
    assert.equal(
      (await fetch(base + '/api/relations/save', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://untrusted.example', 'X-PK-Session': session.token },
        body: JSON.stringify({ ...rel(a, b), confirm: '保存人工关联' }),
      })).status,
      403,
    );
    assert.equal(
      (await request('save', { ...rel(a, { id: randomUUID() }), confirm: '保存人工关联' })).status,
      400,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM relation_details').get().n, 0);
    assert.equal((await request('save', { ...rel(a, b), confirm: '保存人工关联' })).status, 200);
    assert.equal(
      (await fetch(base + '/api/entries/' + b.id, { method: 'DELETE', headers })).status,
      400,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 3);
    const z = await exportBackup(db, dir);
    db.prepare("UPDATE relation_history SET before_json='{}'").run();
    const badZip = await exportBackup(db, dir);
    assert.throws(() => validateBackup(badZip), /快照/);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
