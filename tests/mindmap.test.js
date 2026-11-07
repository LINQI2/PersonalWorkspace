import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStore, saveEntry } from '../app/server/store.js';
import { saveMap, getMap, importMap, validateMindmaps } from '../app/server/mindmaps.js';
import { newMap, validateMap, mapNodes, mapMarkdown, mapFormat } from '../app/shared/mindmap.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { setLifecycle } from '../app/server/lifecycle.js';
import { createApp } from '../app/server/index.js';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-mindmap-'));
const draft = () => ({
  title: '研究导图',
  data: newMap('研究中心'),
  domains: [],
  tags: [],
  collections: [],
});
const changed = (m) => ({
  ...m.entry,
  domains: m.entry.domains.map((t) => t.id),
  tags: m.entry.tags.map((t) => t.id),
  collections: m.entry.collections.map((t) => t.id),
  data: structuredClone(m.data),
  revision: m.revision,
  stamp: m.stamp,
});
const form = (title) => ({
  type: 'note',
  title,
  description: '',
  content: '<p>保留原文</p>',
  domains: [],
  tags: [],
  collections: [],
});
test('mindmap strict interchange bounds nodes/tree/styles/crosslinks without executing external markup', () => {
  const d = newMap();
  d.nodeData.children = [
    { id: 'left', topic: '<script>仅文字</script>', children: [{ id: 'leaf', topic: '下级' }] },
    { id: 'right', topic: '右侧' },
  ];
  d.arrows = [
    {
      id: 'edge',
      from: 'leaf',
      to: 'right',
      label: '补充',
      bidirectional: false,
      delta1: { x: 10, y: 20 },
    },
  ];
  assert.equal(validateMap(d).count, 4);
  assert.ok(mapMarkdown(d, '研究').includes('下级'));
  assert.deepEqual(importMap({ format: mapFormat, version: 1, title: '研究', data: d }).data, d);
  const reject = (fn) => {
    const v = structuredClone(d);
    fn(v);
    assert.throws(() => validateMap(v));
  };
  reject((v) => (v.nodeData.dangerouslySetInnerHTML = '<script>bad</script>'));
  reject((v) => (v.nodeData.hyperLink = 'javascript:alert(1)'));
  reject((v) => (v.nodeData.image = { url: 'https://example.com/tracker' }));
  reject((v) => (v.nodeData.id = 'left'));
  reject((v) => (v.arrows[0].to = 'missing'));
  reject((v) => (v.arrows[0].to = 'leaf'));
  reject((v) => v.arrows.push(v.arrows[0]));
  reject((v) => (v.nodeData.style = { background: 'url(https://example.com)' }));
  reject((v) => (v.arrows[0].delta1.x = Infinity));
  reject((v) => {
    let n = v.nodeData;
    for (let i = 0; i < 14; i++) {
      n.children = [{ id: 'deep' + i, topic: '深' }];
      n = n.children[0];
    }
  });
  reject(
    (v) =>
      (v.nodeData.children = Array.from({ length: 501 }, (_, i) => ({ id: 'n' + i, topic: '多' }))),
  );
  assert.throws(() => importMap({ format: mapFormat, version: 2, title: '错版', data: d }));
  assert.throws(() =>
    importMap({ format: mapFormat, version: 1, title: { unsafe: 'object' }, data: d }),
  );
});
test('map CRUD CAS/metadata conflicts, stable references, pin/trash/reopen and actual ZIP preserve map and histories', async () => {
  const dir = tmp();
  let db = openStore(dir);
  try {
    const note = saveEntry(db, form('原始笔记')),
      t = randomUUID();
    db.prepare('INSERT INTO domains VALUES(?,?)').run(t, '研究');
    const input = draft();
    input.domains = [t];
    input.primary_domain_id = t;
    input.data.nodeData.children = [
      { id: 'nodeA', topic: '可全站检索的内部文字', metadata: { contentId: note.id } },
      { id: 'nodeB', topic: '互补知识' },
    ];
    input.data.arrows = [
      {
        id: 'cross',
        from: 'nodeA',
        to: 'nodeB',
        label: '补充说明',
        bidirectional: true,
        delta1: { x: 12, y: 34 },
        delta2: { x: -10, y: 10 },
      },
    ];
    const m = saveMap(db, input);
    assert.equal(m.entry.mindmap, true);
    assert.equal(m.entry.primary_domain_id, t);
    assert.equal(m.linked[0].id, note.id);
    assert.ok(db.prepare('SELECT id FROM entries WHERE plain_text LIKE ?').get('%内部文字%'));
    assert.throws(() => saveEntry(db, form('不能用普通编辑覆盖'), m.entry.id), /导图编辑器/);
    const next = changed(m);
    next.data.nodeData.children.reverse();
    next.data.nodeData.children[0].topic = '编辑并重排';
    const newer = saveMap(db, next, m.entry.id);
    assert.equal(newer.revision, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM mindmap_versions').get().n, 1);
    assert.throws(() => saveMap(db, next, m.entry.id), /其他窗口/);
    assert.equal(getMap(db, m.entry.id).revision, 2);
    db.prepare('INSERT INTO tags VALUES(?,?)').run(t, '新标签');
    db.prepare('INSERT INTO entry_tags VALUES(?,?)').run(m.entry.id, t);
    assert.throws(() => saveMap(db, changed(newer), m.entry.id), /分类/);
    const target = saveEntry(db, { ...form('更名笔记') }, note.id);
    assert.equal(getMap(db, m.entry.id).linked[0].title, target.title);
    setLifecycle(db, note.id, { action: 'trash', confirm: '移入回收站' });
    assert.equal(getMap(db, m.entry.id).linked[0].state, 'trash');
    setLifecycle(db, m.entry.id, { action: 'trash', confirm: '移入回收站' });
    assert.throws(() => saveMap(db, changed(getMap(db, m.entry.id)), m.entry.id), /回收站/);
    setLifecycle(db, m.entry.id, { action: 'restore' });
    validateMindmaps(db);
    const copy = saveMap(db, { ...changed(getMap(db, m.entry.id)), title: '副本' });
    assert.notEqual(copy.entry.id, m.entry.id);
    assert.equal(copy.data.nodeData.children[1].id, 'nodeA');
    const backup = await exportBackup(db, dir),
      zip = validateBackup(backup);
    try {
      const restored = openStore(zip.tmp);
      assert.deepEqual(getMap(restored, m.entry.id).data, getMap(db, m.entry.id).data);
      assert.equal(restored.prepare('SELECT count(*) n FROM mindmap_versions').get().n, 1);
      restored.close();
    } finally {
      zip.dispose();
    }
    db.close();
    db = openStore(dir);
    assert.equal(getMap(db, m.entry.id).data.arrows[0].delta1.x, 12);
    const clear = changed(getMap(db, m.entry.id));
    clear.domains = [];
    clear.primary_domain_id = null;
    const cleared = saveMap(db, clear, m.entry.id);
    assert.equal(cleared.entry.primary_domain_id, null);
    assert.deepEqual(cleared.entry.domains, []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('mindmap saving is atomic on failure, unknown content IDs rejected and corrupt map/history refuses startup/ZIP', async () => {
  const dir = tmp();
  let db = openStore(dir);
  try {
    const m = saveMap(db, draft()),
      n = changed(m);
    n.data.nodeData.metadata = { contentId: randomUUID() };
    assert.throws(() => saveMap(db, n, m.entry.id), /不存在/);
    assert.equal(getMap(db, m.entry.id).revision, 1);
    db.exec(
      "CREATE TRIGGER injected_failure BEFORE UPDATE ON mindmaps BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    const d = changed(m);
    d.title = '不应写入';
    assert.throws(() => saveMap(db, d, m.entry.id), /injected/);
    assert.equal(getMap(db, m.entry.id).entry.title, m.entry.title);
    assert.equal(db.prepare('SELECT count(*) n FROM mindmap_versions').get().n, 0);
    db.exec('DROP TRIGGER injected_failure');
    db.prepare('UPDATE mindmaps SET data_json=?').run(JSON.stringify({ ...m.data, script: 'bad' }));
    const bytes = await exportBackup(db, dir);
    assert.throws(() => validateBackup(bytes), /导图|格式/);
    db.close();
    db = null;
    assert.throws(() => openStore(dir), /导图格式/);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema10 ->11 verifies recoverable old ZIP, preserves old34 tables and fault rolls back10', async () => {
  const dir = tmp();
  let db = openStore(dir);
  const note = saveEntry(db, form('旧知识'));
  db.exec('DROP TABLE professional_entry_domains;DROP TABLE professional_entries;DROP TABLE professional_domains;DROP TABLE mindmap_versions;DROP TABLE mindmaps;PRAGMA user_version=10');
  db.close();
  db = null;
  try {
    assert.throws(
      () =>
        openStore(dir, {
          beforeMigrationCommit() {
            throw Error('fault11');
          },
        }),
      /fault11/,
    );
    db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10);
    assert.equal(
      db.prepare('SELECT content FROM entries WHERE id=?').get(note.id).content,
      '<p>保留原文</p>',
    );
    db.close();
    db = null;
    db = openStore(dir, {
      validateMigrationBackup(bytes) {
        const z = validateBackup(bytes, { upgrade: false });
        assert.ok([10, 11].includes(z.sourceSchema));
        z.dispose();
      },
    });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
    assert.equal(db.prepare('SELECT count(*) n FROM mindmaps').get().n, 0);
    const file = readdirSync(path.join(dir, 'backups')).find((f) => f.startsWith('pre-schema-11-')),
      z = validateBackup(readFileSync(path.join(dir, 'backups', file)));
    try {
      const r = openStore(z.tmp);
      assert.equal(r.prepare('SELECT title FROM entries WHERE id=?').get(note.id).title, '旧知识');
      r.close();
    } finally {
      z.dispose();
    }
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('mindmap local API requires Origin/session and global search/type filters show stable map IDs', async () => {
  const dir = tmp(),
    store = createApp(dir, { ai: { env: {} } }),
    server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const token = (
      await (await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })).json()
    ).token;
    const req = (p, body, headers = {}) =>
      fetch(base + '/api/' + p, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PK-Request': '1',
          Origin: base,
          'X-PK-Session': token,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await req('mindmaps', draft(), { 'X-PK-Session': 'wrong' })).status, 403);
    assert.equal((await req('mindmaps', draft(), { Origin: 'http://evil.example' })).status, 403);
    const d = draft();
    d.data.nodeData.children = [{ id: 'keyword', topic: '独特节点检索词' }];
    const m = await (await req('mindmaps', d)).json();
    assert.ok(m.entry.id);
    const list = await (
      await fetch(
        base +
          '/api/entries?library=1&content_type=mindmap&q=' +
          encodeURIComponent('独特节点检索词'),
      )
    ).json();
    assert.equal(list.items[0].id, m.entry.id);
    assert.equal(list.items[0].mindmap, true);
    const notes = await (await fetch(base + '/api/entries?library=1&content_type=note')).json();
    assert.ok(!notes.items.some((e) => e.id === m.entry.id));
    const bytes = await (await req('backup', {})).arrayBuffer();
    await req('mindmaps', draft());
    const fd = new FormData();
    fd.append('backup', new Blob([bytes]), 'maps.zip');
    fd.append('confirm', '恢复当前知识库');
    const restored = await fetch(base + '/api/restore', {
      method: 'POST',
      headers: { 'X-PK-Request': '1', Origin: base },
      body: fd,
    });
    assert.equal(restored.status, 200);
    assert.equal(store.getDb().prepare('SELECT count(*) n FROM mindmaps').get().n, 1);
    assert.equal(getMap(store.getDb(), m.entry.id).data.nodeData.children[0].id, 'keyword');
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
