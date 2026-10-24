import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createApp } from '../app/server/index.js';
import { validateBackup } from '../app/server/backup.js';
import { openStore, saveEntry } from '../app/server/store.js';
import { recoverInterruptedRestore } from '../app/server/recovery.js';

test('V1 integration: persistence, relationships, validation and genuine restore', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pk-test-'));
  let store = createApp(directory);
  let server;
  let base;
  const start = async () => {
    server = store.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  };
  await start();
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + '/api' + url, {
      method,
      headers: {
        'X-PK-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      response,
      data: response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()),
    };
  };
  try {
    const taxonomy = {};
    for (const kind of ['domains', 'tags', 'collections']) {
      taxonomy[kind] = [];
      for (let n = 1; n <= 2; n++)
        taxonomy[kind].push(
          (await request('/taxonomy/' + kind, 'POST', { name: kind + n })).data.id,
        );
    }
    const image = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#839ccc' },
    })
      .png()
      .toBuffer();
    const imageForm = new FormData();
    imageForm.append('image', new Blob([image], { type: 'image/png' }), 'image.png');
    const asset = (await request('/assets', 'POST', imageForm)).data;
    assert.ok(asset.id);
    const draft = {
      type: 'bookmark',
      title: '知乎 测试标题',
      url: 'https://www.zhihu.com/question/123',
      description: '独特简介',
      content: `<h2>知识笔记</h2><h3>小标题</h3><p><strong>正文关键词</strong><em>斜体心得</em><img src="${asset.url}" /></p><ul><li>无序要点</li></ul><ol><li>顺序步骤</li></ol><p>符号 &lt;ABC&amp;DEF&gt;</p><a href="https://example.com">参考链接</a>`,
      cover_asset_id: asset.id,
      ...taxonomy,
    };
    const saved = await request('/entries', 'POST', draft);
    assert.equal((await request('/entries?q=' + encodeURIComponent('<ABC&DEF>'))).data.total, 1);
    assert.equal(saved.response.status, 200);
    const id = saved.data.id;
    assert.equal(saved.data.domains.length, 2);
    assert.equal(saved.data.tags.length, 2);
    assert.equal(saved.data.collections.length, 2);
    const note = await request('/entries', 'POST', {
      ...draft,
      type: 'note',
      title: '原创笔记',
      url: '',
      domains: [],
    });
    assert.equal(note.data.url, null);
    assert.equal((await request('/entries?view=pending')).data.total, 1);
    await request('/entries/' + note.data.id, 'PUT', {
      ...draft,
      type: 'note',
      title: '原创笔记',
      url: '',
      domains: taxonomy.domains,
    });
    assert.equal((await request('/entries?view=pending')).data.total, 0);
    await request('/entries/' + note.data.id, 'PUT', {
      ...draft,
      type: 'note',
      title: '原创笔记',
      url: '',
      domains: [],
    });
    for (const key of ['知乎', '独特简介', '正文关键词'])
      assert.equal(
        (await request('/entries?q=' + encodeURIComponent(key))).data.total,
        2 * (key !== '知乎') + (key === '知乎' ? 1 : 0),
      );
    for (const kind of Object.keys(taxonomy))
      for (const tax of taxonomy[kind])
        assert.equal(
          (await request('/entries?' + kind + '=' + tax)).data.total,
          kind === 'domains' ? 1 : 2,
        );
    assert.equal((await request('/entries?q=不存在')).data.total, 0);
    assert.equal((await request('/entries', 'POST', draft)).response.status, 409);
    const dup = await request('/entries', 'POST', { ...draft, allowDuplicate: true });
    assert.equal(dup.response.status, 200);
    await request('/entries/' + dup.data.id, 'DELETE');
    for (const url of [
      'javascript:alert(1)',
      'ftp://test.test',
      'broken',
      'http://user:password@example.com',
    ])
      assert.equal((await request('/entries', 'POST', { ...draft, url })).response.status, 400);
    const malicious = await request('/entries/' + id, 'PUT', {
      ...draft,
      content:
        '<script>alert(1)</script><p onclick="bad()">安全正文</p><img src="https://tracking.example/a.png"><a href="javascript:alert(1)">unsafe</a>',
    });
    assert.equal(malicious.response.status, 200);
    assert.ok(!malicious.data.content.includes('script'));
    assert.ok(!malicious.data.content.includes('onclick'));
    assert.ok(!malicious.data.content.includes('<img'));
    await request('/entries/' + id, 'PUT', draft);
    const fake = new FormData();
    fake.append('image', new Blob(['not an image'], { type: 'image/png' }), 'bad.png');
    assert.equal((await request('/assets', 'POST', fake)).response.status, 400);
    const svg = new FormData();
    svg.append('image', new Blob(['<svg></svg>'], { type: 'image/svg+xml' }), 'bad.svg');
    assert.equal((await request('/assets', 'POST', svg)).response.status, 400);
    assert.equal(
      (
        await fetch(base + '/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + '/api/meta', { headers: { Origin: 'https://evil.example' } })).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      http
        .get(base + '/api/meta', { headers: { Host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(hostStatus, 403);
    // Restart the actual server and database.
    await stop();
    store = createApp(directory);
    await start();
    const persisted = (await request('/entries/' + id)).data;
    assert.equal(persisted.cover_asset_id, asset.id);
    assert.equal(persisted.domains.length, 2);
    assert.ok(persisted.content.includes('正文关键词'));
    assert.equal((await fetch(base + asset.url)).status, 200);
    const snapshot = (await request('/backup', 'POST')).data;
    assert.ok(Buffer.isBuffer(snapshot));
    writeFileSync(path.join(directory, 'exercise.zip'), snapshot);
    const checked = validateBackup(snapshot);
    assert.equal(checked.count, 3); // includes recycled duplicate; no data is physically removed
    checked.dispose();
    await request('/entries/' + id, 'DELETE');
    assert.equal(
      (await request('/taxonomy/domains/' + taxonomy.domains[0], 'DELETE')).response.status,
      400,
    ); // recycled content retains taxonomy references; do not silently remove its domain
    const form = () => {
      const fd = new FormData();
      fd.append('backup', new Blob([snapshot]), 'backup.zip');
      return fd;
    };
    assert.equal((await request('/restore/inspect', 'POST', form())).data.count, 3);
    assert.equal((await request('/restore', 'POST', form())).response.status, 400);
    assert.equal((await request('/entries')).data.total, 1);
    const restoreForm = form();
    restoreForm.append('confirm', '恢复当前知识库');
    const restored = await request('/restore', 'POST', restoreForm);
    assert.equal(restored.response.status, 200);
    assert.ok(existsSync(restored.data.safetyBackup));
    const restoredEntry = (await request('/entries/' + id)).data;
    assert.deepEqual(restoredEntry, persisted);
    assert.equal((await request('/entries')).data.total, 2);
    const assetBytes = Buffer.from(await (await fetch(base + asset.url)).arrayBuffer());
    assert.deepEqual(
      assetBytes,
      readFileSync(path.join(directory, 'attachments', asset.id + '.webp')),
    );
    await request('/taxonomy/domains/' + taxonomy.domains[0], 'DELETE');
    await request('/taxonomy/collections/' + taxonomy.collections[0], 'DELETE');
    await request('/taxonomy/tags/' + taxonomy.tags[0], 'DELETE');
    assert.equal((await request('/entries')).data.total, 2);
    assert.equal((await request('/entries/' + id)).data.domains.length, 2);
    assert.equal((await request('/entries/' + id)).data.tags.length, 1);
    // Corrupted packages and traversal must leave current data unchanged.
    for (const bytes of [
      Buffer.from('broken'),
      (() => {
        const z = new AdmZip(snapshot);
        z.addFile('../evil.txt', Buffer.from('evil'));
        return z.toBuffer();
      })(),
      (() => {
        const z = new AdmZip(snapshot);
        z.addFile('attachments/' + asset.id + '.webp', Buffer.from('tampered'));
        return z.toBuffer();
      })(),
    ]) {
      const fd = new FormData();
      fd.append('backup', new Blob([bytes]), 'bad.zip');
      fd.append('confirm', '恢复当前知识库');
      assert.equal((await request('/restore', 'POST', fd)).response.status, 400);
      assert.equal((await request('/entries')).data.total, 2);
    }
    await stop();
    store = createApp(directory);
    await start();
    assert.equal((await request('/entries')).data.total, 2);
    t.diagnostic(
      'Real restore preserved entry fields, all six associations and image bytes; restart verified twice.',
    );
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('interrupted Windows restore recovers a partially moved original database', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-crash-'));
  try {
    const db = openStore(dir);
    const entry = saveEntry(db, {
      type: 'note',
      title: '保留原始数据',
      description: '',
      content: '<p>重要笔记</p>',
      domains: [],
      tags: [],
      collections: [],
    });
    db.close();
    const old = 'previous-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mkdirSync(path.join(dir, old));
    writeFileSync(path.join(dir, 'restore-journal.json'), JSON.stringify({ previous: old }));
    renameSync(path.join(dir, 'library.sqlite'), path.join(dir, old, 'library.sqlite'));
    // Simulate interruption after the database moved, while original attachments stayed in place.
    assert.equal(recoverInterruptedRestore(dir), true);
    const recovered = openStore(dir);
    assert.equal(
      recovered.prepare('SELECT title FROM entries WHERE id=?').get(entry.id).title,
      '保留原始数据',
    );
    recovered.close();
    assert.ok(existsSync(path.join(dir, 'attachments')));
    assert.ok(!existsSync(path.join(dir, 'restore-journal.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pagination is bounded and pin sorting returns the pinned entry first', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-pages-'));
  const store = createApp(dir);
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let pinned;
    for (let n = 0; n < 27; n++) {
      const e = saveEntry(store.getDb(), {
        type: 'note',
        title: '笔记 ' + n,
        description: '',
        content: '<p>分段检索</p>',
        domains: [],
        tags: [],
        collections: [],
        pinned: n === 3,
      });
      if (n === 3) pinned = e.id;
    }
    const first = await (await fetch(base + '/api/entries?sort=pinned')).json();
    assert.equal(first.total, 27);
    assert.equal(first.items.length, 24);
    assert.equal(first.items[0].id, pinned);
    const second = await (await fetch(base + '/api/entries?sort=pinned&page=2')).json();
    assert.equal(second.items.length, 3);
    assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 27);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
