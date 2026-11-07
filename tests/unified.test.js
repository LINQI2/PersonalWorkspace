import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, saveEntry } from '../app/server/store.js';
import { prepareImport, commitImport } from '../app/server/knowledge/importer.js';
import { parseExchange } from '../app/server/knowledge/exchange.js';
import {
  domainTree,
  saveDomain,
  deleteDomain,
  domainScope,
  assignPrimary,
  provenance,
  validateUnified,
  ruleMembers,
  setRule,
} from '../app/server/unified.js';
import { owner, chapterRows } from '../app/server/knowledge/structure.js';
import { inspect, scope, resolve } from '../app/server/assistant/catalog.js';
import { createAssistantReview } from '../app/server/assistant/review.js';
import { createAiService } from '../app/server/ai/service.js';
import { fixtureKey, deepSeekFixtureResponse } from './ai-fixture.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  readingSchema,
  assistantSchema,
  assertDatabaseSchema,
} from '../app/server/migrations.js';
import { createApp } from '../app/server/index.js';
import { prepareCollectionInput } from '../app/server/ai/collection.js';
import { validateLiveSources } from '../app/server/topics.js';
const sample = JSON.parse(
  readFileSync(new URL('../docs/examples/content-v2-success.json', import.meta.url), 'utf8'),
);
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-unified-'));
function form(title, domains = []) {
  return {
    type: 'note',
    resource_kind: 'knowledge',
    tool_kind: '',
    title,
    url: '',
    description: '',
    content: '<p>合成笔记正文与证据，保存后保留原始资料，不自动确认为事实。</p>',
    cover_asset_id: null,
    pinned: 0,
    domains,
    tags: [],
    collections: [],
  };
}
function review(p) {
  return {
    confirm: '确认导入所选知识',
    items: p.preview.items.map((i) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      body_format: i.body_format || 'plain',
      content_type: i.content_type,
      url: i.url || '',
      description: i.description || '',
      tool_kind: i.tool_kind || 'other',
      parent: i.parent || null,
      domains: [],
      tags: [],
      collections: [],
      primary_domain_id: null,
    })),
    approvedTaxonomy: [],
    approvedDomains: (p.preview.domainSuggestions || []).map((d) => d.id),
    includeRelations: true,
  };
}
const totals = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => [r.name, db.prepare('SELECT * FROM ' + r.name + ' ORDER BY rowid').all()]);
test('v2 four content types and indexed chapters preserve text/source/date/IDs through genuine ZIP and restart', async () => {
  const dir = temp();
  let db = openStore(dir);
  try {
    const p = prepareImport(db, JSON.stringify(sample), 'json'),
      r = commitImport(db, p.prepared, review(p));
    assert.equal(r.count, 5);
    assert.equal(owner(db, r.ids.chapter), r.ids.doc);
    assert.equal(chapterRows(db, r.ids.doc).length, 1);
    assert.equal(
      db.prepare('SELECT resource_kind,url FROM entries WHERE id=?').get(r.ids.tool).url,
      null,
    );
    assert.equal(provenance(db, r.ids.note).sources[0].excerpt, sample.sources[0].excerpt);
    assert.equal(provenance(db, r.ids.note).record.original_date, null);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_directories').get().n, 0);
    const original = JSON.stringify(totals(db));
    validateUnified(db);
    const b = validateBackup(await exportBackup(db, dir));
    try {
      const d = openStore(b.tmp);
      assert.equal(JSON.stringify(totals(d)), original);
      d.close();
    } finally {
      b.dispose();
    }
    db.close();
    db = openStore(dir);
    assert.equal(JSON.stringify(totals(db)), original);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('v2 rejects unsafe/wrong/oversize inputs, missing chapter roots and unknown IDs; review and injected failure roll back all tables', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    for (const item of [
      { ...sample.items[0], body_format: 'html', body: '<img src=x onerror=alert(1)>' },
      { ...sample.items[1], url: 'javascript:alert(1)' },
      { ...sample.items[4], parent: 'missing' },
      { ...sample.items[0], title: '', body: 'x' },
      { ...sample.items[0], body: 'x'.repeat(100001) },
      { ...sample.items[0], content_type: 'unknown' },
    ])
      assert.throws(() => parseExchange(JSON.stringify({ ...sample, items: [item] })));
    assert.throws(() => parseExchange('{"format":"personal-knowledge-exchange","version":2}'));
    const p = prepareImport(db, JSON.stringify(sample), 'json'),
      before = JSON.stringify(totals(db));
    const invalid = review(p);
    invalid.items[0].tags = ['not-a-real-ID'];
    assert.throws(() => commitImport(db, p.prepared, invalid));
    assert.equal(JSON.stringify(totals(db)), before);
    const parentMissing = review(p);
    parentMissing.items = parentMissing.items.filter((i) => i.id !== 'doc');
    assert.throws(() => commitImport(db, p.prepared, parentMissing));
    assert.equal(JSON.stringify(totals(db)), before);
    assert.throws(() =>
      commitImport(db, p.prepared, review(p), {
        beforeCommit: () => {
          throw Error('simulated disk failure');
        },
      }),
    );
    assert.equal(JSON.stringify(totals(db)), before);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('v2 partial adoption, type edits, duplicate packages and duplicate URLs require explicit choices, source snapshot remains immutable', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const p = prepareImport(db, JSON.stringify(sample), 'json'),
      input = review(p);
    input.items = input.items.filter((i) => i.id === 'note' || i.id === 'tool');
    input.items[1].content_type = 'note';
    input.approvedDomains = [];
    const r = commitImport(db, p.prepared, input);
    assert.equal(
      db.prepare('SELECT resource_kind FROM entries WHERE id=?').get(r.ids.tool).resource_kind,
      'knowledge',
    );
    assert.equal(domainTree(db).length, 0);
    assert.equal(
      db.prepare('SELECT raw_input FROM knowledge_imports WHERE id=?').get(r.batchId).raw_input,
      JSON.stringify(sample),
    );
    const repeated = prepareImport(db, JSON.stringify(sample), 'json');
    assert.equal(repeated.preview.repeated.length, 1);
    assert.throws(() => commitImport(db, repeated.prepared, input), /已导入/);
    const one = {
      ...review(repeated),
      items: review(repeated).items.filter((i) => i.id === 'site'),
      repeat: '另存所选知识',
      approvedDomains: [],
    };
    commitImport(db, repeated.prepared, one);
    const n = db.prepare('SELECT count(*) n FROM entries').get().n;
    assert.throws(() => commitImport(db, repeated.prepared, one), /网址已存在/);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, n);
    commitImport(db, repeated.prepared, { ...one, allowDuplicateUrls: true });
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, n + 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('v1 explicit compatible conversion keeps original raw dates, references and page hierarchy without creating parallel directories', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const raw = JSON.stringify({
      format: 'personal-knowledge-exchange',
      version: 1,
      sources: [
        {
          id: 's',
          kind: 'chatgpt',
          title: '合成旧资料',
          excerpt: '旧资料原文',
          original_date: '2025-01-02',
        },
      ],
      directories: [{ id: 'd', name: '旧包领域建议' }],
      items: [
        { id: 'p', kind: 'page', title: '旧概览', body: '概览', directory: 'd' },
        {
          id: 'c',
          kind: 'point',
          parent: 'p',
          title: '旧章节',
          body: '原文判断',
          original_date: '2025-01-02',
          references: [{ source_id: 's', quote: '旧资料' }],
        },
        { id: 'independent', kind: 'point', title: '独立资料', body: '应保留独立' },
      ],
    });
    assert.equal(parseExchange(raw).value.version, 1);
    const p = prepareImport(db, raw, 'json', true);
    assert.equal(p.preview.items[2].content_type, 'note');
    const r = commitImport(db, p.prepared, review(p));
    assert.equal(owner(db, r.ids.c), r.ids.p);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_directories').get().n, 0);
    assert.equal(provenance(db, r.ids.c).record.original_date, '2025-01-02');
    assert.equal(
      db.prepare('SELECT raw_input FROM knowledge_imports WHERE id=?').get(r.batchId).raw_input,
      raw,
    );
    validateUnified(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('domain tree sort/move/cycle/occupied deletion and primary assignment preserve stable IDs and manual topic members', () => {
  const dir = temp();
  let db = openStore(dir);
  try {
    const a = saveDomain(db, { name: '父领域' }),
      b = saveDomain(db, { name: '子领域', parent_id: a.id, position: 4 }),
      c = saveDomain(db, { name: '另一领域' });
    const e = saveEntry(db, form('原笔记', [b.id, c.id]));
    assignPrimary(db, e.id, b.id);
    db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '手工专题');
    db.prepare('INSERT INTO entry_collections VALUES(?,?)').run(e.id, 'topic');
    const original = JSON.stringify(db.prepare('SELECT * FROM entries').all());
    assert.throws(() => saveDomain(db, { name: '父领域', parent_id: b.id }, a.id), /循环/);
    assert.throws(() => deleteDomain(db, a.id));
    assert.throws(() => deleteDomain(db, b.id));
    saveDomain(db, { name: '子领域新名', parent_id: c.id, position: 2 }, b.id);
    assert.deepEqual(domainScope(db, c.id).sort(), [c.id, b.id].sort());
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries').all()), original);
    assert.equal(db.prepare('SELECT count(*) n FROM entry_collections').get().n, 1);
    assert.throws(() => assignPrimary(db, e.id, a.id), /已选/);
    deleteDomain(db, a.id);
    db.close();
    db = openStore(dir);
    assert.equal(domainTree(db).find((d) => d.id === b.id).position, 2);
    validateUnified(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('dynamic topic rules and saved filters preserve manual memberships when domains change', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const a = saveDomain(db, { name: '领域甲' }),
      b = saveDomain(db, { name: '领域乙' }),
      e = saveEntry(db, form('规则成员', [a.id]));
    db.prepare('INSERT INTO collections VALUES(?,?)').run('t', '专题');
    db.prepare('INSERT INTO entry_collections VALUES(?,?)').run(e.id, 't');
    assert.throws(
      () => setRule(db, 't', { rules: { domains: [a.id], tags: [], types: ['note'] } }),
      /确认/,
    );
    setRule(db, 't', {
      rules: { domains: [a.id], tags: [], types: ['note'] },
      confirm: '确认专题筛选规则',
    });
    assert.deepEqual(ruleMembers(db, 't'), [e.id]);
    saveEntry(db, { ...form('规则成员', [b.id]), collections: ['t'] }, e.id);
    assert.equal(ruleMembers(db, 't').length, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM entry_collections').get().n, 1);
    const bytes = await exportBackup(db, dir),
      checked = validateBackup(bytes);
    try {
      const d = openStore(checked.tmp);
      assert.equal(d.prepare('SELECT count(*) n FROM entry_collections').get().n, 1);
      d.close();
    } finally {
      checked.dispose();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('AI structure has one domain hierarchy; merge with primary/rules retains references and restorable reviewed snapshots', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const a = saveDomain(db, { name: '领域甲' }),
      b = saveDomain(db, { name: '领域乙' }),
      child = saveDomain(db, { name: '子领域', parent_id: a.id }),
      e = saveEntry(db, form('原证据', [a.id]));
    assignPrimary(db, e.id, a.id);
    db.prepare('INSERT INTO collections VALUES(?,?)').run('t', '专题');
    setRule(db, 't', {
      rules: { domains: [a.id], tags: [], types: [] },
      confirm: '确认专题筛选规则',
    });
    assert.ok(inspect(db).objects.every((o) => o.kind !== 'directories'));
    const before = JSON.stringify(db.prepare('SELECT * FROM entries').all());
    const suggestion = {
      status: 'ready',
      suggestions: [
        {
          object: 'domains:' + a.id,
          target: 'domains:' + b.id,
          kind: 'domains',
          action: 'merge',
          name: '',
          reason: '合成待审核候选',
          evidenceIds: ['domains:' + a.id],
        },
      ],
      missing: [],
    };
    const ai = createAiService(dir, () => db, {
        env: { PK_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: fixtureKey },
        transport: async () => deepSeekFixtureResponse(suggestion),
      }),
      service = createAssistantReview(() => db, ai, dir);
    const g = await service.generate({
      mode: 'assistant_structure',
      keys: ['domains:' + a.id, 'domains:' + b.id],
    });
    const diff = service.preview({ token: g.token, plan: suggestion, selected: [0] });
    const changed = service.apply({
      token: g.token,
      plan: suggestion,
      selected: [0],
      ...diff,
      confirm: '采用结构变更',
      mergeConfirm: '合并分类并保留引用',
    });
    assert.equal(db.prepare('SELECT domain_id FROM content_primary_domains').get().domain_id, b.id);
    assert.equal(domainTree(db).find((d) => d.id === child.id).parent_id, b.id);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries').all()), before);
    validateUnified(db);
    service.restore({ id: changed.id, confirm: '恢复结构变更' });
    assert.equal(db.prepare('SELECT domain_id FROM content_primary_domains').get().domain_id, a.id);
    assert.equal(domainTree(db).find((d) => d.id === child.id).parent_id, a.id);
    validateUnified(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('dynamic topic AI uses only selected real members and refuses adoption after rules no longer match', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const d = saveDomain(db, { name: '动态领域' });
    db.prepare('INSERT INTO collections VALUES(?,?)').run('t', '动态专题');
    const entries = Array.from({ length: 3 }, (_, i) =>
      saveEntry(db, form('动态证据' + i, [d.id])),
    );
    setRule(db, 't', {
      rules: { domains: [d.id], tags: [], types: ['note'] },
      confirm: '确认专题筛选规则',
    });
    const p = prepareCollectionInput(db, { collectionId: 't', ids: entries.map((e) => e.id) });
    assert.equal(p.sources.length, 3);
    validateLiveSources(db, 't', p.sources);
    setRule(db, 't', {
      rules: { domains: [], tags: [], types: ['tool'] },
      confirm: '确认专题筛选规则',
    });
    assert.throws(() => validateLiveSources(db, 't', p.sources), /移除/);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 3);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema6 ->7 verified pre-upgrade ZIP preserves all old tables and faulty migration remains6', async () => {
  for (const fault of [false, true]) {
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
          'PRAGMA user_version=6',
      );
      saveEntry(db, form('旧库笔记'));
      const before = JSON.stringify(totals(db));
      db.close();
      if (fault)
        assert.throws(() =>
          openStore(dir, {
            beforeMigrationCommit: () => {
              throw Error('fault');
            },
            validateMigrationBackup: (b) => {
              const v = validateBackup(b, { upgrade: false });
              v.dispose();
            },
          }),
        );
      db = fault ? new DatabaseSync(path.join(dir, 'library.sqlite')) : openStore(dir);
      assertDatabaseSchema(db, fault ? 6 : 12);
      const originalTables = JSON.parse(before).map(([name]) => name);
      assert.equal(
        JSON.stringify(totals(db).filter(([name]) => originalTables.includes(name))),
        before,
      );
      const zip = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-7'));
      const valid = validateBackup(readFileSync(path.join(dir, 'backups', zip)));
      try {
        const d = openStore(valid.tmp);
        assertDatabaseSchema(d, 12);
        assert.equal(d.prepare('SELECT title FROM entries').get().title, '旧库笔记');
        d.close();
      } finally {
        valid.dispose();
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('unified local API guards writes and searches child blocks without showing them by default; corrupted tree refuses backup/start', async () => {
  const dir = temp(),
    store = createApp(dir, { ai: { env: {} } }),
    db = store.getDb();
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const p = prepareImport(db, JSON.stringify(sample), 'json');
    commitImport(db, p.prepared, review(p));
    const request = (u) =>
      fetch(base + '/api' + u, { headers: { 'X-PK-Request': '1' } }).then((r) => r.json());
    assert.equal((await request('/entries?library=1')).total, 4);
    assert.equal((await request('/entries?library=1&q=待验证事项')).total, 1);
    assert.equal(
      (
        await fetch(base + '/api/library/views', {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    const s = await request('/local/session');
    assert.equal(
      (
        await fetch(base + '/api/library/views', {
          method: 'POST',
          headers: {
            Origin: base,
            'Content-Type': 'application/json',
            'X-PK-Request': '1',
            'X-PK-Session': s.token,
          },
          body: JSON.stringify({
            name: '常用',
            filters: { domains: [], tags: [], types: ['tool'] },
          }),
        })
      ).status,
      200,
    );
    const rows = domainTree(db),
      root = rows.find((r) => !r.parent_id),
      child = rows.find((r) => r.parent_id);
    db.prepare('UPDATE domain_structure SET parent_id=? WHERE domain_id=?').run(child.id, root.id);
    const zip = await exportBackup(db, dir);
    assert.throws(() => validateBackup(zip), /循环/);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
