import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { legacyStore, seedTopic } from './v13-fixture.js';
import { openStore } from '../app/server/store.js';
import { getCollection } from '../app/server/topics.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { createApp } from '../app/server/index.js';
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-schema2-'));
test('schema1 -> schema2 -> schema3 preserves old tables/relations, creates real recoverable pre-migration ZIP', async () => {
  const dir = temp();
  let db = legacyStore(dir);
  try {
    const entries = seedTopic(db);
    const before = JSON.stringify(db.prepare('SELECT * FROM entries ORDER BY id').all());
    const workspace = { version: 1, preferences: { layout: 'list', sort: 'updated' }, drafts: {} };
    writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(workspace));
    db.close();
    db = openStore(dir);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
    assert.equal(
      JSON.stringify(
        db
          .prepare(
            'SELECT id,type,title,url,description,content,plain_text,cover_asset_id,pinned,created_at,updated_at FROM entries ORDER BY id',
          )
          .all(),
      ),
      before,
    );
    assert.equal(getCollection(db, 'topic').count, 4);
    assert.equal(getCollection(db, 'topic').content, '');
    const backupName = readdirSync(path.join(dir, 'backups')).find((n) =>
      n.startsWith('pre-schema-2-'),
    );
    assert.ok(backupName);
    const checked = validateBackup(readFileSync(path.join(dir, 'backups', backupName)));
    try {
      assert.equal(checked.sourceSchema, 1);
      const restored = openStore(checked.tmp);
      try {
        assert.equal(restored.prepare('SELECT count(*) n FROM entry_collections').get().n, 8);
        assert.equal(
          restored.prepare('SELECT content FROM entries WHERE id=?').get(entries[0].id).content,
          entries[0].content,
        );
      } finally {
        restored.close();
      }
    } finally {
      checked.dispose();
    }
    db.close();
    db = openStore(dir);
    assert.equal(readdirSync(path.join(dir, 'backups')).length, 11);
    assert.equal(readFileSync(path.join(dir, 'workspace.json'), 'utf8'), JSON.stringify(workspace));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('failed schema2 migration rolls back; incompatible/corrupt/unversioned DBs refuse safely', () => {
  for (const kind of ['fault', 'future', 'trigger', 'unversioned']) {
    const dir = temp();
    let db = legacyStore(dir);
    try {
      seedTopic(db);
      if (kind === 'future') db.exec('PRAGMA user_version=99');
      if (kind === 'trigger')
        db.exec('CREATE TRIGGER unexpected AFTER INSERT ON tags BEGIN SELECT 1; END');
      if (kind === 'unversioned') db.exec('PRAGMA user_version=0');
      db.close();
      assert.throws(() =>
        openStore(
          dir,
          kind === 'fault'
            ? {
                beforeMigrationCommit: () => {
                  throw Error('test migration fault');
                },
              }
            : {},
        ),
      );
      db = new DatabaseSync(path.join(dir, 'library.sqlite'), { readOnly: true });
      assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 4);
      assert.equal(
        db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='collection_documents'").get()
          .n,
        0,
      );
      assert.equal(
        db.prepare('PRAGMA user_version').get().user_version,
        kind === 'future' ? 99 : kind === 'unversioned' ? 0 : 1,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('genuine schema1 ZIP restores through isolated migration into current schema3 API', async () => {
  const old = temp(),
    dir = temp();
  let legacy = legacyStore(old);
  seedTopic(legacy);
  const bytes = await exportBackup(legacy, old);
  legacy.close();
  const store = createApp(dir, { ai: { env: {} } });
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const fd = new FormData();
    fd.append('backup', new Blob([bytes]), 'old.zip');
    fd.append('confirm', '恢复当前知识库');
    const res = await fetch(base + '/api/restore', {
      method: 'POST',
      headers: { 'X-PK-Request': '1' },
      body: fd,
    });
    assert.equal(res.status, 200);
    assert.equal((await (await fetch(base + '/api/meta')).json()).schemaVersion, 12);
    assert.equal((await (await fetch(base + '/api/collections/topic')).json()).count, 4);
    assert.equal((await (await fetch(base + '/api/entries')).json()).total, 4);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(old, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
