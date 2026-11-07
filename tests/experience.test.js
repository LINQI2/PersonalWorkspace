import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, saveEntry } from '../app/server/store.js';
import { quickCapture, setLifecycle, validateLifecycle } from '../app/server/lifecycle.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { createApp } from '../app/server/index.js';
import { resolve, catalog } from '../app/server/assistant/catalog.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  readingSchema,
  assistantSchema,
  unifiedSchema,
  relationSchema,
  assertDatabaseSchema,
} from '../app/server/migrations.js';
import { changeRelations, writeRelation } from '../app/server/relations.js';
import { batchEntries } from '../app/server/library.js';
import { saveRecord, transaction } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-experience-'));
test('chapter recycling refuses safely, batch failures roll back prior workflow writes and recycle pagination includes empty tools', async () => {
  const dir = temp(),
    s = createApp(dir, { ai: { env: {} } }),
    db = s.getDb(),
    server = s.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const a = quickCapture(db, { text: '保持收集状态' }),
      form = {
        type: 'note',
        title: '综合文档',
        url: '',
        description: '',
        content: '<p>原始正文</p>',
        domains: [],
        tags: [],
        collections: [],
        kind: 'page',
        directory_id: null,
        priority: 0,
        status: 'review',
        epistemic: 'user_material',
        questions: '',
        references: [],
        original_date: null,
        date_note: '',
      };
    form.epistemic = 'ai_inference';
    const page = saveRecord(db, form),
      block = saveRecord(db, { ...form, kind: 'point', title: '内部知识块' });
    transaction(db, () => attach(db, { items: [{ id: block.id, parent_id: page.id }] }));
    assert.throws(
      () => setLifecycle(db, block.id, { action: 'trash', confirm: '移入回收站' }),
      /内部章节/,
    );
    assert.throws(
      () => batchEntries(db, { ids: [a.id, page.id], action: 'delete', confirm: '删除所选条目' }),
      /仍有章节/,
    );
    assert.equal(
      db.prepare('SELECT state FROM content_lifecycle WHERE entry_id=?').get(a.id).state,
      'inbox',
    );
    for (let i = 0; i < 30; i++) {
      const e = saveEntry(db, {
        type: 'note',
        resource_kind: 'tool',
        tool_kind: 'desktop',
        title: '空备注工具' + i,
        url: '',
        description: '',
        content: '',
        domains: [],
        tags: [],
        collections: [],
      });
      setLifecycle(db, e.id, { action: 'trash', confirm: '移入回收站' });
    }
    const base = 'http://127.0.0.1:' + server.address().port;
    const first = await (await fetch(base + '/api/entries?view=trash&library=1')).json(),
      second = await (await fetch(base + '/api/entries?view=trash&library=1&page=2')).json();
    assert.equal(first.total, 30);
    assert.equal(first.items.length, 24);
    assert.equal(second.items.length, 6);
    setLifecycle(db, page.id, { action: 'done' });
    const reviewed = await (await fetch(base + '/api/entries?library=1&status=review')).json();
    assert.equal(reviewed.items.length, 1);
    assert.equal(reviewed.items[0].id, page.id);
    assert.equal(
      db.prepare('SELECT status FROM knowledge_records WHERE entry_id=?').get(page.id).status,
      'review',
    );
  } finally {
    await new Promise((r) => server.close(r));
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('quick capture safely persists raw text/link and optional metadata; duplicates and failures are transactional', () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const e = quickCapture(db, { text: '灵感 <script>alert(1)</script>\n保留原始记录' });
    assert.equal(e.type, 'note');
    assert.match(e.plain_text, /<script>/);
    assert.doesNotMatch(e.content, /<script>/);
    assert.equal(
      db.prepare('SELECT state FROM content_lifecycle WHERE entry_id=?').get(e.id).state,
      'inbox',
    );
    const b = quickCapture(db, { text: '分享 https://example.com/research。原始说明' });
    assert.equal(b.type, 'bookmark');
    assert.throws(
      () => quickCapture(db, { text: 'https://example.com/research。原始说明' }),
      /已存在/,
    );
    assert.throws(() => quickCapture(db, { text: '坏分类', domains: ['missing'] }), /分类/);
    assert.throws(() => quickCapture(db, { text: 'x'.repeat(20001) }), /20000/);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM content_lifecycle').get().n, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('inbox completion, postponement, trash and restore preserve stable IDs/body/taxonomy/source; quoted deletion refuses', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const a = quickCapture(db, { text: '第一条知识原始内容' }),
      b = quickCapture(db, { text: '第二条知识原始内容' }),
      before = db.prepare('SELECT * FROM entries WHERE id=?').get(a.id);
    setLifecycle(db, a.id, { action: 'later' });
    setLifecycle(db, a.id, { action: 'done' });
    assert.throws(() => setLifecycle(db, a.id, { action: 'trash' }), /确认/);
    setLifecycle(db, a.id, { action: 'trash', confirm: '移入回收站' });
    assert.deepEqual(db.prepare('SELECT * FROM entries WHERE id=?').get(a.id), before);
    assert.throws(() => resolve(db, 'entries:' + a.id), /回收站/);
    assert.ok(!catalog(db).some((r) => r.id === a.id));
    assert.throws(() => setLifecycle(db, a.id, { action: 'inbox' }), /恢复/);
    setLifecycle(db, a.id, { action: 'restore' });
    assert.equal(resolve(db, 'entries:' + a.id).name, before.title);
    changeRelations(db, () =>
      writeRelation(db, {
        from_id: b.id,
        to_id: a.id,
        type: 'reference',
        note: '人工引用',
        state: 'confirmed',
      }),
    );
    assert.throws(() => setLifecycle(db, a.id, { action: 'trash', confirm: '移入回收站' }), /引用/);
    const z = validateBackup(await exportBackup(db, dir)),
      restored = openStore(z.tmp);
    try {
      assert.equal(
        restored.prepare('SELECT state FROM content_lifecycle WHERE entry_id=?').get(a.id).state,
        'done',
      );
      assert.equal(restored.prepare('SELECT count(*) n FROM relation_details').get().n, 1);
    } finally {
      restored.close();
      z.dispose();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('ordinary notes retain safe previous text versions; ZIP rejects corrupt lifecycle or unsafe historical HTML', async () => {
  const dir = temp(),
    db = openStore(dir);
  try {
    const e = quickCapture(db, { text: '原始事实 2024' });
    saveEntry(
      db,
      {
        ...e,
        title: '修改后的标题',
        content: '<p>新判断 2025</p>',
        domains: [],
        tags: [],
        collections: [],
      },
      e.id,
    );
    const v = db.prepare('SELECT * FROM content_versions').get();
    assert.equal(v.title, e.title);
    assert.equal(v.content, e.content);
    const z = validateBackup(await exportBackup(db, dir));
    z.dispose();
    db.prepare("UPDATE content_versions SET content='<script>bad</script>'").run();
    assert.throws(() => validateLifecycle(db), /历史/);
    const invalid = await exportBackup(db, dir);
    assert.throws(() => validateBackup(invalid), /历史/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema8 sequential upgrade creates validated schema8 ZIP; migration faults preserve every old row and refuse unsafe version', async () => {
  for (const fail of [false, true]) {
    const dir = temp();
    mkdirSync(path.join(dir, 'attachments'));
    let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    db.exec(
      baseSchema +
        topicSchema +
        toolSchema +
        knowledgeSchema +
        readingSchema +
        assistantSchema +
        unifiedSchema +
        relationSchema +
        'PRAGMA user_version=8',
    );
    const e = saveEntry(db, {
      type: 'note',
      title: '旧笔记',
      url: '',
      description: '',
      content: '<p>旧正文</p>',
      domains: [],
      tags: [],
      collections: [],
    });
    db.close();
    try {
      if (fail)
        assert.throws(
          () =>
            openStore(dir, {
              validateMigrationBackup: (bytes) =>
                validateBackup(bytes, { upgrade: false }).dispose(),
              beforeMigrationCommit: () => {
                throw Error('故障');
              },
            }),
          /故障/,
        );
      else {
        db = openStore(dir);
        assertDatabaseSchema(db, 12);
        assert.equal(
          db.prepare('SELECT content FROM entries WHERE id=?').get(e.id).content,
          '<p>旧正文</p>',
        );
        db.close();
      }
      db = new DatabaseSync(path.join(dir, 'library.sqlite'));
      assertDatabaseSchema(db, fail ? 8 : 12);
      db.close();
      const file = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-9'));
      const z = validateBackup(readFileSync(path.join(dir, 'backups', file)), { upgrade: false });
      assert.equal(z.sourceSchema, 8);
      z.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('local workflow API protects same-origin/session, excludes trash, keeps pin first independently of sort and restores originals', async () => {
  const dir = temp(),
    s = createApp(dir, { ai: { env: {} } }),
    db = s.getDb(),
    server = s.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port,
    headers = { 'X-PK-Request': '1', Origin: base, 'Content-Type': 'application/json' };
  try {
    const session = await (await fetch(base + '/api/local/session', { headers })).json(),
      post = (url, body, token = session.token) =>
        fetch(base + '/api' + url, {
          method: 'POST',
          headers: { ...headers, 'X-PK-Session': token },
          body: JSON.stringify(body),
        });
    assert.equal((await post('/capture', { text: 'test' }, 'bad')).status, 403);
    const a = await (await post('/capture', { text: 'Z置顶知识' })).json(),
      b = await (await post('/capture', { text: 'A普通知识' })).json();
    db.prepare('UPDATE entries SET pinned=1 WHERE id=?').run(a.id);
    const list = async (q) => await (await fetch(base + '/api/entries?library=1&' + q)).json();
    assert.equal((await list('sort=title')).items[0].id, a.id);
    await post('/content/' + a.id + '/action', { action: 'done' });
    assert.deepEqual(
      (await list('view=inbox')).items.map((e) => e.id),
      [b.id],
    );
    await post('/content/' + b.id + '/action', { action: 'trash', confirm: '移入回收站' });
    assert.equal((await list('view=inbox')).total, 0);
    assert.equal((await list('view=trash')).items[0].id, b.id);
    await post('/content/' + b.id + '/action', { action: 'restore' });
    assert.equal((await list('view=inbox')).items[0].id, b.id);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 2);
  } finally {
    await new Promise((r) => server.close(r));
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
