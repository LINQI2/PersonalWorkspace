import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createApp } from '../app/server/index.js';
import { openStore } from '../app/server/store.js';
import { topicSchema, assertDatabaseSchema } from '../app/server/migrations.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { legacyStore, seedTopic } from './v13-fixture.js';
import { fixtureForm } from './ai-fixture.js';
test('schema2 -> 3 preserves every original column/relation/topic and creates recoverable ZIP; failure rolls back', async () => {
  for (const fault of [false, true]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-tools-migration-'));
    let db = legacyStore(dir);
    try {
      seedTopic(db);
      db.exec(topicSchema + 'PRAGMA user_version=2;');
      db.prepare(
        'INSERT INTO collection_documents(collection_id,content,revision) VALUES(?,?,?)',
      ).run('topic', '<h2>旧总结</h2><p>重要事实保留</p>', 7);
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => r.name);
      const columns = Object.fromEntries(
        tables.map((t) => [
          t,
          db
            .prepare(`PRAGMA table_info(${t})`)
            .all()
            .map((c) => c.name)
            .join(','),
        ]),
      );
      const snapshot = (d) =>
        JSON.stringify(
          tables.map((t) => d.prepare(`SELECT ${columns[t]} FROM ${t} ORDER BY 1,2`).all()),
        );
      const before = snapshot(db),
        oldZip = await exportBackup(db, dir);
      writeFileSync(
        path.join(dir, 'workspace.json'),
        JSON.stringify({ version: 1, preferences: { layout: 'list', sort: 'title' }, drafts: {} }),
      );
      const workspace = readFileSync(path.join(dir, 'workspace.json'), 'utf8');
      db.close();
      if (fault)
        assert.throws(
          () =>
            openStore(dir, {
              beforeMigrationCommit: () => {
                throw Error('injected');
              },
              validateMigrationBackup: (b) => validateBackup(b, { upgrade: false }).dispose(),
            }),
          /injected/,
        );
      db = fault
        ? new DatabaseSync(path.join(dir, 'library.sqlite'))
        : openStore(dir, {
            validateMigrationBackup: (b) => validateBackup(b, { upgrade: false }).dispose(),
          });
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, fault ? 2 : 12);
      assert.equal(snapshot(db), before);
      assert.equal(readFileSync(path.join(dir, 'workspace.json'), 'utf8'), workspace);
      assertDatabaseSchema(db, fault ? 2 : 12);
      const zip = readdirSync(path.join(dir, 'backups')).find((n) => n.startsWith('pre-schema-3-'));
      assert.ok(zip);
      for (const bytes of [readFileSync(path.join(dir, 'backups', zip)), oldZip]) {
        const checked = validateBackup(bytes);
        try {
          const restored = openStore(checked.tmp);
          try {
            assert.equal(snapshot(restored), before);
            assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 12);
          } finally {
            restored.close();
          }
        } finally {
          checked.dispose();
        }
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
test('tools CRUD: optional URL, safe local icon/notes, filters/global search, stable topics, separate drafts, restart and actual ZIP restore', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-tools-api-'));
  let store = createApp(dir, { ai: { env: {} } }),
    server,
    base;
  const start = async () => {
    server = store.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  const stop = async () => {
    await new Promise((r) => server.close(r));
    store.close();
  };
  const api = async (url, method = 'GET', body) => {
    const r = await fetch(base + '/api' + url, {
      method,
      headers: {
        'X-PK-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    await start();
    const tax = {};
    for (const k of ['domains', 'tags', 'collections'])
      tax[k] = (await api('/taxonomy/' + k, 'POST', { name: '工具测试' + k })).data.id;
    const image = await sharp({
        create: { width: 40, height: 40, channels: 4, background: '#26786b' },
      })
        .png()
        .toBuffer(),
      fd = new FormData();
    fd.append('image', new Blob([image], { type: 'image/png' }), 'icon.png');
    const asset = (await api('/assets', 'POST', fd)).data;
    const form = {
      ...fixtureForm,
      type: 'note',
      resource_kind: 'tool',
      tool_kind: 'desktop',
      title: '测试桌面工具',
      url: '',
      description: '本地编辑器',
      content: '<p>经验全文检索unique-note</p><script>bad()</script>',
      cover_asset_id: asset.id,
      ...Object.fromEntries(Object.entries(tax).map(([k, id]) => [k, [id]])),
    };
    const created = await api('/entries', 'POST', form);
    assert.equal(created.status, 200);
    const tool = created.data;
    assert.equal(tool.url, null);
    assert.equal(tool.resource_kind, 'tool');
    assert.ok(!tool.content.includes('script'));
    assert.ok(tool.cover.endsWith('.webp'));
    assert.equal(
      (
        await api(
          '/entries?view=tools&tool_kind=desktop&domains=' +
            tax.domains +
            '&tags=' +
            tax.tags +
            '&collections=' +
            tax.collections,
        )
      ).data.total,
      1,
    );
    assert.equal((await api('/entries?view=tools&tool_kind=ai')).data.total, 0);
    assert.equal((await api('/entries?q=unique-note')).data.items[0].id, tool.id);
    assert.equal((await api('/entries?view=notes')).data.total, 0);
    assert.equal((await api('/meta')).data.stats.tools, 1);
    assert.equal((await api('/collections/' + tax.collections)).data.count, 1);
    for (const value of [
      { tool_kind: 'exe' },
      { url: 'file:///c:/private' },
      { url: 'https://user:pass@example.com' },
    ])
      assert.equal((await api('/entries/' + tool.id, 'PUT', { ...form, ...value })).status, 400);
    let updated = await api('/entries/' + tool.id, 'PUT', {
      ...form,
      url: 'https://example.com/tool',
      title: '更新后的工具',
    });
    assert.equal(updated.data.id, tool.id);
    assert.equal(
      (await api('/entries', 'POST', { ...fixtureForm, url: 'https://example.com/tool#duplicate' }))
        .status,
      409,
    );
    const { resource_kind, tool_kind, ...legacyForm } = {
      ...form,
      title: '兼容旧客户端',
      url: 'https://example.com/tool',
    };
    updated = await api('/entries/' + tool.id, 'PUT', legacyForm);
    assert.equal(updated.data.resource_kind, 'tool');
    assert.equal(updated.data.tool_kind, 'desktop');
    await api('/drafts/new', 'PUT', { form: fixtureForm });
    await api('/drafts/new-tool', 'PUT', { form });
    assert.equal((await api('/drafts/new-tool')).data.form.tool_kind, 'desktop');
    assert.equal((await api('/drafts/new')).data.form.title, fixtureForm.title);
    const zip = Buffer.from(
      await (
        await fetch(base + '/api/backup', { method: 'POST', headers: { 'X-PK-Request': '1' } })
      ).arrayBuffer(),
    );
    await api('/entries/' + tool.id, 'DELETE');
    assert.equal((await api('/collections/' + tax.collections)).data.count, 0);
    const restore = new FormData();
    restore.append('backup', new Blob([zip]), 'tools.zip');
    restore.append('confirm', '恢复当前知识库');
    assert.equal((await api('/restore', 'POST', restore)).status, 200);
    await stop();
    store = createApp(dir, { ai: { env: {} } });
    await start();
    const persisted = (await api('/entries/' + tool.id)).data;
    assert.equal(persisted.title, '兼容旧客户端');
    assert.equal(persisted.tool_kind, 'desktop');
    assert.equal(persisted.cover, tool.cover);
    assert.deepEqual(persisted.collections, tool.collections);
    assert.equal((await api('/drafts/new-tool')).data.form.tool_kind, 'desktop');
    assert.equal((await api('/ai/status')).data.configured, false);
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
