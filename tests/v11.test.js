import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../app/server/index.js';
import { saveEntry, openStore } from '../app/server/store.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { recoverInterruptedRestore } from '../app/server/recovery.js';
import { acquireDataLock } from '../app/server/lock.js';
import sharp from 'sharp';
test('V1.1 persists preferences, recent choices, drafts and non-destructive batch edits through restart/backup', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v11-'));
  let store = createApp(dir),
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
  await start();
  const api = async (url, method = 'GET', input) => {
    const res = await fetch(base + '/api' + url, {
      method,
      headers: {
        'X-PK-Request': '1',
        ...(input instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body:
        input instanceof FormData ? input : input === undefined ? undefined : JSON.stringify(input),
    });
    return {
      status: res.status,
      data: res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : Buffer.from(await res.arrayBuffer()),
    };
  };
  try {
    const domain = (await api('/taxonomy/domains', 'POST', { name: '设计' })).data,
      tag = (await api('/taxonomy/tags', 'POST', { name: '最近标签' })).data;
    const form = {
      type: 'bookmark',
      title: '原始收藏',
      url: 'https://EXAMPLE.com:443#section',
      description: '保持简介',
      content: '<h2>原有语义</h2><p><strong>保持加粗</strong></p>',
      cover_asset_id: null,
      domains: [domain.id],
      tags: [tag.id],
      collections: [],
      pinned: 0,
    };
    const entry = (await api('/entries', 'POST', form)).data;
    const note = (
      await api('/entries', 'POST', {
        ...form,
        type: 'note',
        title: '第二条笔记',
        url: '',
        domains: [],
      })
    ).data;
    assert.equal(
      (await api('/duplicate?url=' + encodeURIComponent('https://example.com/'))).data.duplicate.id,
      entry.id,
    );
    assert.equal(
      (await api('/entries', 'POST', { ...form, url: 'https://example.com/#new' })).status,
      409,
    );
    assert.equal(
      (await api('/duplicate?url=' + encodeURIComponent('https://example.com/?different=1'))).data
        .duplicate,
      null,
    );
    assert.equal((await api('/preferences', 'PUT', { layout: 'list', sort: 'title' })).status, 200);
    assert.equal((await api('/preferences', 'PUT', { layout: 'invalid' })).status, 400);
    assert.equal((await api('/preferences')).data.layout, 'list');
    const image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#448877' },
    })
      .png()
      .toBuffer();
    const upload = new FormData();
    upload.append('image', new Blob([image], { type: 'image/png' }), 'draft.png');
    const asset = (await api('/assets', 'POST', upload)).data;
    const draftContent = '<p>草稿图片</p><img src="' + asset.url + '" />';
    assert.equal(
      (
        await api('/drafts/new', 'PUT', {
          form: {
            ...form,
            title: '未保存草稿',
            url: '尚未填写完整',
            content: draftContent,
            cover_asset_id: asset.id,
          },
          baseUpdatedAt: '',
        })
      ).status,
      200,
    );
    assert.equal((await api('/drafts/bad-key', 'PUT', { form })).status, 400);
    assert.deepEqual(
      (await api('/drafts')).data.map((d) => [d.key, d.title, d.missingEntry]),
      [['new', '未保存草稿', false]],
    );
    assert.equal((await api('/meta')).data.recent.domains[0].id, domain.id);
    assert.equal((await api('/meta')).data.recent.tags[0].id, tag.id);
    await api('/batch', 'POST', {
      ids: [entry.id, note.id],
      action: 'add',
      kind: 'domains',
      taxonomyIds: [domain.id],
    });
    assert.equal((await api('/entries?view=pending')).data.total, 0);
    assert.equal((await api('/entries/' + entry.id)).data.content, entry.content);
    assert.equal((await api('/entries/' + entry.id)).data.description, entry.description);
    await api('/entries/' + note.id + '/pin', 'PATCH', { pinned: true });
    assert.equal((await api('/entries?sort=pinned')).data.items[0].id, note.id);
    const unchanged = (await api('/entries/' + entry.id)).data;
    assert.equal(
      (
        await api('/batch', 'POST', {
          ids: [entry.id, 'missing'],
          action: 'delete',
          confirm: '删除所选条目',
        })
      ).status,
      400,
    );
    assert.deepEqual((await api('/entries/' + entry.id)).data, unchanged);
    assert.equal((await api('/batch', 'POST', { ids: [entry.id], action: 'delete' })).status, 400);
    const backup = (await api('/backup', 'POST')).data;
    const checked = validateBackup(backup);
    assert.ok(existsSync(path.join(checked.tmp, 'workspace.json')));
    checked.dispose();
    await stop();
    store = createApp(dir);
    await start();
    assert.deepEqual((await api('/preferences')).data, { layout: 'list', sort: 'title' });
    assert.equal((await api('/drafts/new')).data.form.title, '未保存草稿');
    assert.equal((await api('/drafts/new')).data.form.content, draftContent);
    assert.equal((await api('/drafts/new')).data.form.cover_asset_id, asset.id);
    const assetBytes = Buffer.from(await (await fetch(base + asset.url)).arrayBuffer());
    assert.ok(assetBytes.length > 0);
    assert.equal((await api('/meta')).data.recent.domains[0].id, domain.id);
    await api('/preferences', 'PUT', { layout: 'grid' });
    await api('/drafts/new', 'DELETE');
    await api('/batch', 'POST', { ids: [note.id], action: 'delete', confirm: '删除所选条目' });
    const fd = new FormData();
    fd.append('backup', new Blob([backup]), 'snapshot.zip');
    fd.append('confirm', '恢复当前知识库');
    assert.equal((await api('/restore', 'POST', fd)).status, 200);
    assert.equal((await api('/entries')).data.total, 2);
    assert.equal((await api('/preferences')).data.layout, 'list');
    assert.equal((await api('/drafts/new')).data.form.title, '未保存草稿');
    assert.equal((await api('/drafts/new')).data.form.content, draftContent);
    assert.deepEqual(Buffer.from(await (await fetch(base + asset.url)).arrayBuffer()), assetBytes);
    // A genuine V1 snapshot has no workspace sidecar. It remains importable in V1.1.
    const v1Dir = mkdtempSync(path.join(os.tmpdir(), 'pk-old-'));
    const v1Db = openStore(v1Dir);
    saveEntry(v1Db, { ...form, domains: [], tags: [] });
    const old = await exportBackup(v1Db, v1Dir);
    v1Db.close();
    rmSync(v1Dir, { recursive: true, force: true });
    const oldFd = new FormData();
    oldFd.append('backup', new Blob([old]), 'v1.zip');
    oldFd.append('confirm', '恢复当前知识库');
    assert.equal((await api('/restore', 'POST', oldFd)).status, 200);
    assert.deepEqual((await api('/preferences')).data, { layout: 'grid', sort: 'recent' });
    assert.equal((await api('/drafts/new')).data, null);
    assert.equal((await api('/entries')).data.items[0].content, entry.content);
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('restore journal rolls workspace back together with the database', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-sidecar-'));
  try {
    const db = openStore(dir);
    db.close();
    const old = 'previous-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mkdirSync(path.join(dir, old));
    writeFileSync(path.join(dir, 'workspace.json'), 'original');
    renameSync(path.join(dir, 'library.sqlite'), path.join(dir, old, 'library.sqlite'));
    renameSync(path.join(dir, 'workspace.json'), path.join(dir, old, 'workspace.json'));
    writeFileSync(path.join(dir, 'workspace.json'), 'replacement');
    writeFileSync(path.join(dir, 'restore-journal.json'), JSON.stringify({ previous: old }));
    recoverInterruptedRestore(dir);
    assert.equal(readFileSync(path.join(dir, 'workspace.json'), 'utf8'), 'original');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('data directory lock rejects a second service and can be released safely', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-lock-'));
  try {
    const release = acquireDataLock(dir);
    assert.throws(() => acquireDataLock(dir), /已有服务/);
    release();
    const second = acquireDataLock(dir);
    second();
    assert.ok(!existsSync(path.join(dir, '.server-lock.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
