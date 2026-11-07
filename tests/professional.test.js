import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, saveEntry } from '../app/server/store.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import {
  saveProfessionalDomain,
  saveProfessional,
  readProfessional,
  searchProfessional,
  validateProfessional,
  personalSql,
} from '../app/server/professional.js';
import { seedSamples, seedPreview } from '../app/server/professional-seed.js';

test('professional sample initialization is idempotent and preserves manual edits', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-professional-seed-'));
  const db = openStore(dir);
  try {
    assert.equal(seedPreview(db).domains.length, 35);
    assert.equal(seedPreview(db).cards.length, 12);
    seedSamples(db, { confirm: '创建已审核专业样例' });
    const e = searchProfessional(db, { q: '角色控制器' })[0];
    db.prepare('UPDATE entries SET title=? WHERE id=?').run('人工保留名称', e.id);
    seedSamples(db, { confirm: '创建已审核专业样例' });
    assert.equal(seedPreview(db).cards.length, 0);
    assert.equal(
      db.prepare('SELECT title FROM entries WHERE id=?').get(e.id).title,
      '人工保留名称',
    );
    assert.equal(db.prepare('SELECT count(*) n FROM professional_domains').get().n, 35);
    assert.equal(db.prepare('SELECT count(*) n FROM knowledge_sources').get().n, 12);
    validateProfessional(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('professional shares UUID/body/history/sources, has independent domains, CAS and atomic validation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-professional-'));
  const db = openStore(dir);
  try {
    const personal = saveEntry(db, {
      type: 'note',
      title: '个人资料',
      description: '',
      content: '<p>保留个人正文</p>',
      domains: [],
      tags: [],
      collections: [],
    });
    const root = saveProfessionalDomain(db, { name: '游戏研发' });
    const domain = saveProfessionalDomain(db, { name: '物理', parent_id: root.id });
    assert.throws(
      () => saveProfessionalDomain(db, { ...root, parent_id: domain.id }, root.id),
      /循环/,
    );
    const form = {
      title: '角色控制器',
      description: '根据输入和碰撞约束计算角色位移。',
      content: '<p>控制移动策略，不等同于刚体动力学求解。</p>',
      concept_kind: 'concept',
      aliases: ['Character Controller'],
      scope_note: '具体行为取决于物理引擎。',
      professional_domains: [domain.id],
      primary_domain: domain.id,
    };
    const card = saveProfessional(db, form);
    assert.equal(db.prepare('SELECT count(*) n FROM domains').get().n, 0);
    assert.deepEqual(
      db
        .prepare(`SELECT e.id FROM entries e WHERE ${personalSql(db)}`)
        .all()
        .map((e) => e.id),
      [personal.id],
    );
    assert.equal(searchProfessional(db, { q: 'character', domain: root.id })[0].id, card.id);
    assert.throws(() => saveProfessional(db, { ...form, primary_domain: root.id }), /主要领域/);
    assert.equal(db.prepare('SELECT count(*) n FROM professional_entries').get().n, 1);
    const updated = saveProfessional(
      db,
      { ...form, title: '角色移动控制器', revision: card.revision, updated_at: card.updated_at },
      card.id,
    );
    assert.equal(updated.id, card.id);
    assert.equal(
      db.prepare('SELECT count(*) n FROM knowledge_versions WHERE entry_id=?').get(card.id).n,
      1,
    );
    assert.throws(
      () =>
        saveProfessional(
          db,
          { ...form, revision: card.revision, updated_at: card.updated_at },
          card.id,
        ),
      /已更新/,
    );
    assert.throws(() => saveProfessional(db, form, personal.id), /隐式转换/);
    validateProfessional(db);
    const pack = validateBackup(await exportBackup(db, dir));
    try {
      const restored = openStore(pack.tmp);
      try {
        assert.equal(readProfessional(restored, card.id).title, updated.title);
      } finally {
        restored.close();
      }
    } finally {
      pack.dispose();
    }
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema11 to12 preserves old entries, validated pre-migration ZIP and rollback', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-professional-migrate-'));
  let db = openStore(dir);
  const note = saveEntry(db, {
    type: 'note',
    title: '旧资料',
    description: '',
    content: '<p>原始正文</p>',
    domains: [],
    tags: [],
    collections: [],
  });
  db.exec(
    'DROP TABLE professional_entry_domains;DROP TABLE professional_entries;DROP TABLE professional_domains;PRAGMA user_version=11',
  );
  db.close();
  try {
    assert.throws(
      () =>
        openStore(dir, {
          beforeMigrationCommit() {
            throw Error('fault12');
          },
        }),
      /fault12/,
    );
    db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 11);
    db.close();
    let checked = false;
    db = openStore(dir, {
      validateMigrationBackup(bytes) {
        const p = validateBackup(bytes, { upgrade: false });
        try {
          assert.equal(p.sourceSchema, 11);
          checked = true;
        } finally {
          p.dispose();
        }
      },
    });
    assert.ok(checked);
    assert.equal(
      db.prepare('SELECT content FROM entries WHERE id=?').get(note.id).content,
      note.content,
    );
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
    assert.ok(readdirSync(path.join(dir, 'backups')).some((n) => n.startsWith('pre-schema-12-')));
    db.close();
    db = openStore(dir);
    validateProfessional(db);
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
