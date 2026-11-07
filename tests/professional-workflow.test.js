import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, saveEntry } from '../app/server/store.js';
import { seedSamples, seedPreview } from '../app/server/professional-seed.js';
import {
  readProfessional,
  searchProfessional,
  saveProfessional,
} from '../app/server/professional.js';
import { createProfessionalImport } from '../app/server/professional-import.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { setLifecycle } from '../app/server/lifecycle.js';
import { attach } from '../app/server/knowledge/structure.js';
import { applyOperation } from '../app/server/assistant/review.js';
import { collectionRelations } from '../app/server/topics.js';
import { batchEntries } from '../app/server/library.js';
import { createApp } from '../app/server/index.js';
import { prepareAssistant } from '../app/server/ai/assistant.js';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'pk-professional-flow-'));
const seed = (db) => {
  seedSamples(db, { confirm: '创建已审核专业样例' });
  seedSamples(db, { confirm: '创建已审核专业样例', batch: 'full' });
};
test('40 nonempty cards retain review boundaries and sources, reinitialization does not overwrite', async () => {
  const dir = tmp(),
    db = openStore(dir);
  try {
    seed(db);
    assert.equal(searchProfessional(db).length, 40);
    assert.equal(seedPreview(db, 'full').cards.length, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_sources').get().n, 40);
    assert.equal(
      db.prepare("SELECT count(*) n FROM knowledge_relations WHERE state='candidate'").get().n,
      32,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM knowledge_sources WHERE date_note LIKE '待核验%'").get().n,
      5,
    );
    const archive = validateBackup(await exportBackup(db, dir));
    try {
      const copy = openStore(archive.tmp);
      assert.equal(searchProfessional(copy).length, 40);
      copy.close();
    } finally {
      archive.dispose();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('professional import preserves original package, selections, sources and genuine ZIP; stale and duplicate commits refuse', async () => {
  const dir = tmp(),
    db = openStore(dir);
  try {
    seed(db);
    const domain = db.prepare('SELECT id FROM professional_domains LIMIT 1').get().id;
    const item = {
      id: 'local-a',
      title: '导入的专业定义',
      description: '有意义的定义',
      content: '<p>来源支持的实际正文，人工仍需审核适用条件。</p>',
      concept_kind: 'concept',
      aliases: ['Imported Concept'],
      scope_note: '仅为隔离测试样例。',
      professional_domains: [domain],
      primary_domain: domain,
      sources: [
        {
          kind: 'website',
          title: '合成来源',
          url: 'https://example.com/source',
          excerpt: '合成原始依据',
          date_note: '仅测试',
        },
      ],
    };
    const raw = JSON.stringify({ format: 'professional-knowledge-v1', entries: [item] }),
      service = createProfessionalImport(() => db);
    const p = service.preview(raw);
    assert.equal(searchProfessional(db).length, 40);
    const result = service.commit({
      token: p.token,
      ids: ['local-a'],
      confirm: '确认导入专业知识',
    });
    const id = result.items[0].id;
    assert.notEqual(id, 'local-a');
    assert.equal(readProfessional(db, id).status, 'review');
    assert.equal(db.prepare('SELECT raw_input FROM knowledge_imports').get().raw_input, raw);
    assert.throws(
      () => service.commit({ token: p.token, ids: ['local-a'], confirm: '确认导入专业知识' }),
      /过期/,
    );
    const duplicate = service.preview(raw);
    assert.throws(
      () =>
        service.commit({ token: duplicate.token, ids: ['local-a'], confirm: '确认导入专业知识' }),
      /同名/,
    );
    const stale = service.preview(raw);
    saveEntry(db, {
      type: 'note',
      title: '个人变化',
      description: '',
      content: '<p>不覆盖</p>',
      domains: [],
      tags: [],
      collections: [],
    });
    assert.throws(
      () =>
        service.commit({
          token: stale.token,
          ids: ['local-a'],
          confirm: '确认导入专业知识',
          duplicate: '另存新知识',
        }),
      /变化/,
    );
    const archive = validateBackup(await exportBackup(db, dir));
    try {
      const restored = openStore(archive.tmp);
      assert.equal(readProfessional(restored, id).sources.length, 1);
      restored.close();
    } finally {
      archive.dispose();
    }
    assert.throws(
      () =>
        service.preview(
          JSON.stringify({
            format: 'professional-knowledge-v1',
            entries: [{ ...item, sources: [] }],
          }),
        ),
      /来源/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('professional lifecycle/history and old write paths cannot contaminate personal structures', () => {
  const dir = tmp(),
    db = openStore(dir);
  try {
    seed(db);
    const e = readProfessional(db, searchProfessional(db, { q: '核心游戏循环' })[0].id);
    assert.throws(()=>prepareAssistant(db,{mode:'assistant_qa',keys:['entries:'+e.id],question:'解释这个概念',space:'personal'}));
    assert.doesNotThrow(()=>prepareAssistant(db,{mode:'assistant_qa',keys:['entries:'+e.id],question:'解释这个概念',space:'professional'}));
    assert.throws(()=>prepareAssistant(db,{mode:'assistant_structure',keys:['entries:'+e.id],space:'professional'}));
    assert.throws(() => attach(db, { items: [{ id: e.id, parent_id: null }] }), /专业/);
    assert.throws(
      () =>
        applyOperation(db, dir, {
          action: 'move',
          object: 'entries:' + e.id,
          kind: 'entries',
          target: '',
        }),
      /专业/,
    );
    const collection = 'test-personal';
    db.prepare('INSERT INTO collections VALUES(?,?)').run(collection, '个人专题');
    assert.throws(
      () => collectionRelations(db, collection, { ids: [e.id], action: 'add' }),
      /专业/,
    );
    assert.throws(
      () =>
        batchEntries(db, {
          action: 'add',
          kind: 'collections',
          taxonomyIds: [collection],
          ids: [e.id],
        }),
      /专业/,
    );
    // A new imported card has no relation guards; history and trash/restore remain real engine operations.
    const domain = e.professional_domains[0].id;
    const f = {
      title: '可恢复卡片',
      description: '测试定义',
      content: '<p>旧正文</p>',
      aliases: [],
      concept_kind: 'concept',
      scope_note: '测试边界',
      professional_domains: [domain],
      primary_domain: domain,
    };
    const a = saveProfessional(db, f),
      b = saveProfessional(
        db,
        { ...f, content: '<p>新正文</p>', revision: a.revision, updated_at: a.updated_at },
        a.id,
      );
    assert.equal(
      db.prepare('SELECT content FROM knowledge_versions WHERE entry_id=?').get(a.id).content,
      '<p>旧正文</p>',
    );
    setLifecycle(db, a.id, { action: 'trash', confirm: '移入回收站', updated_at: b.updated_at });
    assert.equal(searchProfessional(db, { view: 'trash' }).length, 1);
    assert.equal(readProfessional(db, a.id).content, '<p>新正文</p>');
    assert.throws(
      () => saveProfessional(db, { ...f, revision: b.revision, updated_at: b.updated_at }, b.id),
      /回收站/,
    );
    setLifecycle(db, a.id, { action: 'restore' });
    assert.equal(searchProfessional(db, { view: 'trash' }).length, 0);
    assert.ok(searchProfessional(db).some((x) => x.id === a.id));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('40 professional cards and tasks survive actual unified backup/restore with post-restore service handles', async () => {
  const dir = tmp(),
    store = createApp(dir, { ai: { env: {} } });
  seed(store.getDb());
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body) =>
    fetch(base + '/api' + url, {
      method: 'POST',
      headers: {
        'X-PK-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  try {
    assert.equal((await post('/tasks', { title: '保留的任务' })).status, 201);
    const response = await post('/workspace/backup', {});
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    await post('/tasks', { title: '备份之后新增' });
    const form = new FormData();
    form.append('backup', new Blob([bytes], { type: 'application/zip' }), 'workspace.zip');
    form.append('confirm', '恢复工作空间');
    const restore = await post('/workspace/restore', form);
    assert.equal(restore.status, 200, await restore.text());
    const cards = await (await fetch(base + '/api/professional/search')).json();
    assert.equal(cards.length, 40);
    const tasks = await (await fetch(base + '/api/tasks')).json();
    assert.equal(tasks.tasks.length, 1);
    assert.equal(tasks.tasks[0].title, '保留的任务');
    const personal = await (await fetch(base + '/api/entries')).json();
    assert.equal(personal.total, 0);
  } finally {
    await new Promise((r) => server.close(r));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
