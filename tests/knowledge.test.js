import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app/server/index.js';
import { openStore, saveEntry } from '../app/server/store.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  assertDatabaseSchema,
} from '../app/server/migrations.js';
import {
  parseExchange,
  exchangeSchema,
  validateExchangeSchema,
} from '../app/server/knowledge/exchange.js';
import {
  knowledgeTables,
  saveDirectory,
  saveRecord,
  getRecord,
  listRecords,
  moveRecord,
  saveKnowledgeDraft,
} from '../app/server/knowledge/store.js';
import { prepareImport, commitImport } from '../app/server/knowledge/importer.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { exchangeFixture, reviewed, commitBody } from './knowledge-fixture.js';
import { fixtureForm } from './ai-fixture.js';
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-knowledge-'));
const form = (title, patch = {}) => ({
  ...fixtureForm,
  type: 'note',
  title,
  url: '',
  kind: 'point',
  directory_id: null,
  priority: 0,
  status: 'review',
  epistemic: 'ai_inference',
  questions: '',
  original_date: null,
  date_note: '',
  references: [],
  ...patch,
});
test('exchange real Schema and bounds: valid dates/quotes, malformed/unsafe/unknown/version/ids/depth reject, text never guessed', () => {
  const good = exchangeFixture();
  assert.equal(
    parseExchange(readFileSync('docs/examples/knowledge-success.json', 'utf8')).value.items.length,
    3,
  );
  assert.throws(() => parseExchange(readFileSync('docs/examples/knowledge-invalid.json', 'utf8')));
  validateExchangeSchema(good, exchangeSchema);
  assert.equal(parseExchange(JSON.stringify(good)).value.items.length, 3);
  for (const mutate of [
    (p) => delete p.items[0].title,
    (p) => (p.version = 2),
    (p) => (p.items[0].priority = 4),
    (p) => (p.items[0].status = 'confirmed'),
    (p) => (p.items[0].original_date = '2026-02-30'),
    (p) => (p.items[0].recorded_at = '2026-01-01T25:00:00Z'),
    (p) => (p.items[0].references[0].quote = '虚构引用'),
    (p) => (p.items[0].references[0].source_id = 'outside'),
    (p) => (p.items[1].id = p.items[0].id),
    (p) => (p.sources[0].url = 'file:///C:/private'),
    (p) => {
      p.items[0].body_format = 'html';
      p.items[0].body = '<script>bad()</script>';
    },
    (p) => {
      p.items[0].body_format = 'html';
      p.items[0].body =
        '<a href="#" data-entry-id="00000000-0000-0000-0000-000000000000">伪造引用</a>';
    },
    (p) => (p.directories[0].parent = 'practice'),
    (p) => (p.items = Array(101).fill(p.items[0])),
    (p) => (p.unknown = 'forbidden'),
  ]) {
    const p = exchangeFixture();
    mutate(p);
    assert.throws(() => parseExchange(JSON.stringify(p)));
  }
  assert.throws(() => parseExchange('{'));
  assert.throws(() => parseExchange('{"__proto__":{}}'));
  const deep = {};
  let cursor = deep;
  for (let i = 0; i < 10; i++) cursor = cursor.next = {};
  assert.throws(() => parseExchange(JSON.stringify(deep)), /嵌套/);
  assert.throws(() => parseExchange('x'.repeat(512 * 1024 + 1), 'text'));
  const raw = '# 标题\n- 原始条目\n<script>不可执行</script>';
  const text = parseExchange(raw, 'markdown');
  assert.equal(text.value.items.length, 1);
  assert.equal(text.value.sources[0].excerpt, raw);
  assert.ok(text.value.items[0].content.includes('&lt;script&gt;'));
});
test('reviewed import creates only selected records, stable sources/dates, unknown taxonomy opt-in, candidates not confirmed, repeat explicit', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const raw = JSON.stringify(exchangeFixture());
    const p = prepareImport(db, raw, 'json');
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 0);
    const result = commitImport(db, p.prepared, {
      ...commitBody(p.preview),
      items: reviewed(p.preview).slice(0, 2),
      approvedTaxonomy: [{ kind: 'tags', name: '待核对' }],
      approvedDirectories: ['research', 'practice'],
      includeRelations: true,
    });
    assert.equal(result.count, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM domains').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM collections').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_directories').get().n, 2);
    const a = getRecord(db, result.ids['point-1']),
      b = getRecord(db, result.ids['point-2']);
    assert.notEqual(a.id, b.id);
    assert.equal(a.title, b.title);
    assert.equal(a.sources[0].quote, '只做小样本实验。');
    assert.equal(a.original_date, '2026-09-20');
    assert.equal(b.original_date, null);
    assert.equal(b.confirmed_at, null);
    assert.equal(a.provided_recorded_at, '2026-09-22T09:00:00+08:00');
    assert.equal(a.sources[0].provided_recorded_at, a.provided_recorded_at);
    assert.notEqual(a.created_at, a.provided_recorded_at);
    assert.ok(a.relations.every((r) => r.state === 'candidate'));
    assert.equal(a.tags[0].name, '待核对');
    assert.ok(a.import_batch);
    const again = prepareImport(db, raw, 'json');
    assert.equal(again.preview.repeated.length, 1);
    assert.throws(() => commitImport(db, again.prepared, commitBody(again.preview)), /同一份/);
    const saved = commitImport(db, again.prepared, {
      ...commitBody(again.preview),
      repeat: '另存所选知识',
      items: reviewed(again.preview).slice(2),
    });
    assert.equal(saved.count, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 3);
    assert.throws(
      () =>
        commitImport(db, again.prepared, {
          ...commitBody(again.preview),
          repeat: '另存所选知识',
          items: [{ ...reviewed(again.preview)[0], status: 'confirmed' }],
        }),
      /明确确认/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('atomic import rolls back all records/sources/created taxonomy/directories/relations, manual drafts survive', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    saveKnowledgeDraft(db, 'new', form('未保存个人草稿'));
    const p = prepareImport(db, JSON.stringify(exchangeFixture()), 'json');
    const before = JSON.stringify(
      [...knowledgeTables, 'entries', 'tags'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
    );
    assert.throws(
      () =>
        commitImport(
          db,
          p.prepared,
          {
            ...commitBody(p.preview),
            approvedTaxonomy: [{ kind: 'tags', name: '待核对' }],
            approvedDirectories: ['research', 'practice'],
            includeRelations: true,
          },
          {
            beforeCommit: () => {
              throw Error('fault after writing');
            },
          },
        ),
      /fault/,
    );
    assert.equal(
      JSON.stringify(
        [...knowledgeTables, 'entries', 'tags'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
      ),
      before,
    );
    commitImport(db, p.prepared, commitBody(p.preview));
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_drafts').get().n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('knowledge directory/page/point/order/priority/cross-topic resources and explicit judgment; modifying body invalidates confirmation', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const root = saveDirectory(db, { name: '根目录' }),
      child = saveDirectory(db, { name: '子目录', parent_id: root.id });
    assert.throws(
      () => saveDirectory(db, { name: '根目录', parent_id: child.id }, root.id),
      /循环/,
    );
    for (const [id, name] of [
      ['topic1', '跨专题一'],
      ['topic2', '跨专题二'],
    ])
      db.prepare('INSERT INTO collections VALUES(?,?)').run(id, name);
    const tool = saveEntry(db, {
      ...fixtureForm,
      type: 'note',
      resource_kind: 'tool',
      tool_kind: 'custom',
      url: '',
      title: '混合引用工具',
    });
    const a = saveRecord(
        db,
        form('知识一', { directory_id: child.id, collections: ['topic1', 'topic2'], priority: 2 }),
      ),
      b = saveRecord(db, form('知识二', { directory_id: child.id, priority: 3 }));
    assert.equal(listRecords(db, { directory: child.id, sort: 'priority' }).items[0].id, b.id);
    moveRecord(db, b.id, -1);
    assert.equal(listRecords(db, { directory: child.id }).items[0].id, b.id);
    const page = saveRecord(
      db,
      form('混合页面', { kind: 'page', directory_id: root.id, references: [tool.id, a.id] }),
    );
    assert.equal(page.references.length, 2);
    assert.equal(getRecord(db, a.id).collections.length, 2);
    const current = getRecord(db, a.id),
      confirmed = saveRecord(
        db,
        form('知识一', {
          ...current,
          domains: [],
          tags: [],
          collections: ['topic1', 'topic2'],
          references: [],
          status: 'confirmed',
          confirm: '确认判断',
        }),
        a.id,
      );
    assert.ok(confirmed.confirmed_at);
    saveEntry(
      db,
      {
        ...fixtureForm,
        type: 'note',
        url: '',
        title: confirmed.title,
        content: '<p>修正观点，不应自动确认新版本。</p>',
      },
      a.id,
    );
    assert.equal(getRecord(db, a.id).status, 'review');
    assert.equal(getRecord(db, a.id).confirmed_at, null);
    assert.throws(() => saveEntry(db, { ...fixtureForm, type: 'bookmark' }, a.id), /保持笔记/);
    const capture = saveRecord(
      db,
      form('快速原文', { kind: 'capture', status: 'inbox', content: '<p>原始灵感不会丢失</p>' }),
    );
    assert.equal(capture.sources[0].excerpt, '原始灵感不会丢失 ');
    const zip = await exportBackup(db, dir),
      checked = validateBackup(zip);
    try {
      const restored = openStore(checked.tmp);
      try {
        assert.equal(getRecord(restored, page.id).references.length, 2);
        assert.equal(getRecord(restored, a.id).collections.length, 0);
        assert.equal(
          getRecord(restored, capture.id).sources[0].excerpt,
          capture.sources[0].excerpt,
        );
      } finally {
        restored.close();
      }
    } finally {
      checked.dispose();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema3 -> 4 preserves all old fields/assets/workspace/usage with real pre-upgrade ZIP and failure rollback', async () => {
  for (const fail of [false, true]) {
    const dir = temp();
    let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    try {
      const fs = await import('node:fs');
      fs.mkdirSync(path.join(dir, 'attachments'));
      db.exec(baseSchema);
      db.exec(topicSchema + toolSchema + 'PRAGMA user_version=3;');
      saveEntry(db, { ...fixtureForm, title: '旧资源无损' });
      const before = JSON.stringify(db.prepare('SELECT * FROM entries').all());
      writeFileSync(
        path.join(dir, 'workspace.json'),
        JSON.stringify({ version: 1, preferences: { layout: 'grid', sort: 'recent' }, drafts: {} }),
      );
      writeFileSync(path.join(dir, 'ai-usage.json'), 'unchanged synthetic ledger');
      db.close();
      if (fail)
        assert.throws(() =>
          openStore(dir, {
            beforeMigrationCommit: () => {
              throw Error('migration fault');
            },
          }),
        );
      db = fail ? new DatabaseSync(path.join(dir, 'library.sqlite')) : openStore(dir);
      assertDatabaseSchema(db, fail ? 3 : 12);
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM entries').all()), before);
      assert.equal(
        readFileSync(path.join(dir, 'ai-usage.json'), 'utf8'),
        'unchanged synthetic ledger',
      );
      const backup = readdirSync(path.join(dir, 'backups')).find((f) =>
        f.startsWith('pre-schema-4-'),
      );
      assert.ok(backup);
      const checked = validateBackup(readFileSync(path.join(dir, 'backups', backup)));
      try {
        const restored = openStore(checked.tmp);
        try {
          assert.equal(JSON.stringify(restored.prepare('SELECT * FROM entries').all()), before);
        } finally {
          restored.close();
        }
      } finally {
        checked.dispose();
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('protected import API requires same origin/session/review token; one-time commit and genuine restore/restart retain imported sources', async () => {
  const dir = temp();
  let store = createApp(dir, { ai: { env: {} } }),
    server,
    base,
    session;
  const start = async () => {
    server = store.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
    session = (
      await (await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })).json()
    ).token;
  };
  const request = async (path, body, headers = {}) => {
    const r = await fetch(base + '/api/knowledge' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PK-Request': '1',
        Origin: base,
        'X-PK-Session': session,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const stop = async () => {
    await new Promise((r) => server.close(r));
    store.close();
  };
  try {
    await start();
    const payload = { raw: JSON.stringify(exchangeFixture()), format: 'json' };
    for (const h of [
      { Origin: 'https://evil.example' },
      { 'X-PK-Session': 'wrong' },
      { 'X-PK-Request': '' },
      { Origin: '' },
    ])
      assert.equal((await request('/import/preview', payload, h)).status, 403);
    const preview = (await request('/import/preview', payload)).data;
    const committed = await request('/import/commit', commitBody(preview));
    assert.equal(committed.status, 200);
    assert.equal((await request('/import/commit', commitBody(preview))).status, 400);
    saveKnowledgeDraft(store.getDb(), 'new', form('待恢复的独立知识草稿'));
    const bytes = Buffer.from(
      await (
        await fetch(base + '/api/backup', { method: 'POST', headers: { 'X-PK-Request': '1' } })
      ).arrayBuffer(),
    );
    await fetch(base + '/api/entries/' + committed.data.ids['point-1'], {
      method: 'DELETE',
      headers: { 'X-PK-Request': '1' },
    });
    const fd = new FormData();
    fd.append('backup', new Blob([bytes]), 'knowledge.zip');
    fd.append('confirm', '恢复当前知识库');
    assert.equal(
      (
        await fetch(base + '/api/restore', {
          method: 'POST',
          headers: { 'X-PK-Request': '1' },
          body: fd,
        })
      ).status,
      200,
    );
    await stop();
    store = createApp(dir, { ai: { env: {} } });
    await start();
    const persisted = await (
      await fetch(base + '/api/knowledge/records/' + committed.data.ids['point-1'])
    ).json();
    assert.equal(persisted.sources[0].original_date, '2026-09-20');
    assert.equal(persisted.provided_recorded_at, '2026-09-22T09:00:00+08:00');
    assert.equal(persisted.status, 'review');
    assert.equal(
      (await (await fetch(base + '/api/knowledge/drafts/new')).json()).form.title,
      '待恢复的独立知识草稿',
    );
    assert.equal(
      (await request('/import/source', { id: persisted.import_batch.batch_id })).data.raw_input,
      payload.raw,
    );
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
