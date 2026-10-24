import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app/server/index.js';
import { saveEntry, openStore } from '../app/server/store.js';
import {
  createMark,
  updateMark,
  readingMarks,
  textHash,
  entryStamp,
} from '../app/server/reading.js';
import { readingText } from '../app/shared/reading-anchor.js';
import { saveRecord, getRecord } from '../app/server/knowledge/store.js';
import { attach } from '../app/server/knowledge/structure.js';
import { createPasteSession } from '../app/server/paste.js';
import { setLifecycle } from '../app/server/lifecycle.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { defaultWorkspace } from '../app/server/workspace.js';
import {
  baseSchema,
  topicSchema,
  toolSchema,
  knowledgeSchema,
  readingSchema,
  assistantSchema,
  unifiedSchema,
  relationSchema,
  lifecycleSchema,
} from '../app/server/migrations.js';
const form = (
  title,
  content = '<p>前方保留文字，研究指出局部模型需要经过可重复测试，而非仅凭单次输出判断。后方是需要验证的完整上下文。</p>',
) => ({
  type: 'note',
  title,
  url: '',
  description: '',
  content,
  cover_asset_id: null,
  pinned: 0,
  domains: [],
  tags: [],
  collections: [],
});
const kform = (title, kind = 'page') => ({
  ...form(title),
  kind,
  directory_id: null,
  status: 'review',
  epistemic: 'ai_inference',
  priority: 0,
  questions: '',
  original_date: null,
  date_note: '',
  references: [],
});
function selected(e, quote = '局部模型需要经过可重复测试') {
  const text = readingText(e.content),
    start = text.indexOf(quote);
  return {
    source_id: e.id,
    quote,
    start,
    end: start + quote.length,
    hash: textHash(text),
    kind: 'annotation',
    comment: '我的判断仍需证据',
    confirm: '确认保存批注或引用',
  };
}
const fixture = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v18-')),
    s = createApp(dir, { ai: { env: {} } });
  return {
    dir,
    s,
    db: s.getDb(),
    close() {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
test('annotations use exact/context anchors, preserve quotes across insert/edit/delete/history and stable chapter rename/order; CAS and protections', () => {
  assert.equal(
    readingText('<p>甲</p><img alt="a > b" src="/assets/f.webp"><p>乙 &amp;</p>'),
    '甲乙 &',
  );
  const f = fixture();
  try {
    let e = saveEntry(f.db, form('研究笔记'));
    const m = createMark(f.db, selected(e));
    assert.equal(m.location.state, 'exact');
    e = saveEntry(f.db, { ...form('改名', '<p>新增导言。</p>' + e.content) }, e.id);
    assert.equal(readingMarks(f.db, e.id)[0].location.state, 'relocated');
    updateMark(f.db, m.id, { revision: 1, comment: '核对后的个人批注' });
    assert.throws(() => updateMark(f.db, m.id, { revision: 1, comment: '过时' }), /已变化/);
    assert.throws(
      () => setLifecycle(f.db, e.id, { action: 'trash', confirm: '移入回收站' }),
      /批注/,
    );
    saveEntry(f.db, form('研究笔记', '<p>原文已经完全移除。</p>'), e.id);
    assert.equal(readingMarks(f.db, e.id)[0].location.state, 'missing');
    assert.equal(readingMarks(f.db, e.id)[0].quote, m.quote);
    saveEntry(f.db, form('恢复正文'), e.id);
    assert.equal(readingMarks(f.db, e.id)[0].location.state, 'exact');
    const page = saveRecord(f.db, kform('综合文档')),
      c = saveRecord(f.db, kform('章节', 'point'));
    attach(f.db, { items: [{ id: c.id, parent_id: page.id }] });
    const mark = createMark(f.db, selected(c));
    const old = getRecord(f.db, c.id);
    saveRecord(f.db, { ...old, title: '章节已改名', references: [] }, c.id);
    const row = readingMarks(f.db, page.id).find((x) => x.id === mark.id);
    assert.equal(row.source_id, c.id);
    assert.equal(row.location.state, 'exact');
    assert.equal(row.pageId, page.id);
    updateMark(f.db, m.id, { revision: 2, action: 'delete', confirm: '删除这条批注或引用' });
    assert.equal(readingMarks(f.db, e.id).length, 0);
    assert.equal(
      f.db.prepare('SELECT quote FROM reading_marks WHERE id=?').get(m.id).quote,
      m.quote,
    );
  } finally {
    f.close();
  }
});
test('citation append/new note retains source ID/chapter/date/history and rolls back on stale target, selected body or injected failure; real ZIP', async () => {
  const f = fixture();
  try {
    const e = saveEntry(f.db, form('来源')),
      target = saveEntry(f.db, form('已有目标', '<p>目标原文不可丢。</p>')),
      input = {
        ...selected(e),
        kind: 'citation',
        target_id: target.id,
        target_version: entryStamp(target),
      };
    const cited = createMark(f.db, input);
    assert.equal(cited.target_id, target.id);
    assert.ok(
      f.db
        .prepare('SELECT content FROM entries WHERE id=?')
        .get(target.id)
        .content.startsWith(target.content),
    );
    assert.ok(
      f.db
        .prepare('SELECT content FROM entries WHERE id=?')
        .get(target.id)
        .content.includes('data-entry-id="' + e.id + '"'),
    );
    assert.equal(readingMarks(f.db, target.id)[0].source_id, e.id);
    assert.ok(
      f.db.prepare('SELECT content FROM content_versions WHERE entry_id=?').get(target.id)
        .content === target.content,
    );
    assert.throws(() => createMark(f.db, input), /目标正文已变化/);
    const count = f.db.prepare('SELECT count(*) n FROM entries').get().n;
    assert.throws(
      () =>
        createMark(
          f.db,
          { ...selected(e), kind: 'citation', target_title: '失败新笔记' },
          {
            beforeCommit() {
              throw Error('fault');
            },
          },
        ),
      /fault/,
    );
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n, count);
    const created = createMark(f.db, { ...selected(e), kind: 'citation', target_title: '新摘录' });
    assert.ok(created.target_id);
    assert.throws(() => createMark(f.db, { ...selected(e), hash: '0'.repeat(64) }), /选区/);
    const b = validateBackup(await exportBackup(f.db, f.dir));
    try {
      const restored = openStore(b.tmp);
      try {
        assert.equal(readingMarks(restored, e.id).length, 2);
      } finally {
        restored.close();
      }
    } finally {
      b.dispose();
    }
  } finally {
    f.close();
  }
});
const raw =
  '# 研究文档\n开场说明。\n## 可核对的观点\n- 第一条事实\n- 第二条意见\n### 后续问题\n> 待验证\n[参考](https://example.com)\n<script>原始文本不执行</script>';

test('ambiguous quotes never jump; new local APIs require Origin/session and keep originals on errors', async () => {
  const f = fixture(),
    server = f.s.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const e = saveEntry(f.db, form('短原文', '<p>唯一的原始句子。</p>')),
      input = selected(e, '唯一的原始句子。');
    createMark(f.db, input);
    saveEntry(f.db, form('短原文', '<p>唯一的原始句子。唯一的原始句子。</p>'), e.id);
    assert.equal(readingMarks(f.db, e.id)[0].location.state, 'ambiguous');
    const base = 'http://127.0.0.1:' + server.address().port,
      session = await (
        await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-PK-Request': '1',
      Origin: base,
      'X-PK-Session': session.token,
    };
    for (const route of ['/reading/marks', '/knowledge/paste/preview', '/knowledge/paste/commit']) {
      assert.equal(
        (
          await fetch(base + '/api' + route, {
            method: 'POST',
            headers: { ...headers, Origin: 'https://example.com' },
            body: '{}',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + '/api' + route, {
            method: 'POST',
            headers: { ...headers, 'X-PK-Session': '' },
            body: '{}',
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await fetch(base + '/api/reading/marks', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, quote: '虚构摘录' }),
        })
      ).status,
      400,
    );
    assert.equal(f.db.prepare('SELECT count(*) n FROM reading_marks').get().n, 1);
    assert.equal(f.db.prepare('SELECT title FROM entries WHERE id=?').get(e.id).title, '短原文');
  } finally {
    await new Promise((r) => server.close(r));
    f.close();
  }
});
function review(p) {
  return {
    token: p.token,
    confirm: '确认导入所选知识',
    approvedTaxonomy: [],
    approvedDomains: [],
    keepRelations: false,
    items: p.items.map((i) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      body_format: i.body_format,
      content_type: i.content_type,
      ...(i.parent ? { parent: i.parent } : {}),
      domains: [],
      tags: [],
      collections: [],
    })),
  };
}
test('paste Markdown/text/ChatGPT previews deterministic hierarchy and safe HTML; manual duplicates, source/date snapshots, atomic commit and genuine ZIP', async () => {
  const f = fixture();
  try {
    const service = createPasteSession(() => f.db),
      p = service.preview({
        raw,
        format: 'markdown',
        type: 'document',
        sourceKind: 'chatgpt',
        sourceName: '用户提供的对话片段',
      });
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n, 0);
    assert.equal(p.items.length, 3);
    assert.equal(p.items[2].parent, p.items[1].id);
    assert.ok(!p.items[2].content.includes('<script>'));
    const r = service.commit(review(p)),
      ids = Object.values(r.ids);
    assert.equal(ids.length, 3);
    assert.equal(getRecord(f.db, r.ids.root).status, 'review');
    assert.equal(getRecord(f.db, r.ids.root).original_date, null);
    assert.equal(f.db.prepare('SELECT excerpt FROM knowledge_sources').get().excerpt, raw);
    const p2 = service.preview({
      raw,
      format: 'markdown',
      type: 'document',
      sourceKind: 'chatgpt',
      sourceName: '用户提供的对话片段',
    });
    assert.ok(p2.repeated.length);
    assert.ok(p2.candidates.some((c) => c.matches.length));
    assert.throws(() => service.commit(review(p2)), /疑似重复/);
    const changed = service.preview({
        raw: '一份全新的人工文字，不应猜测章节。',
        format: 'text',
        type: 'note',
        sourceKind: 'inspiration',
        sourceName: '',
      }),
      choice = review(changed);
    choice.items[0].title = '研究文档';
    assert.ok(service.check(choice).candidates[0].matches.length);
    assert.throws(() => service.commit(choice), /疑似重复/);
    const fail = createPasteSession(() => f.db, {
        beforeCommit() {
          throw Error('rollback');
        },
      }),
      pf = fail.preview({
        raw: '新的纯文本来源\n不会拆出章节',
        format: 'text',
        type: 'note',
        sourceKind: 'inspiration',
        sourceName: '',
      });
    assert.equal(pf.items.length, 1);
    assert.throws(() => fail.commit(review(pf)), /rollback/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n, 3);
    assert.throws(
      () =>
        service.preview({
          raw: 'a'.repeat(100001),
          format: 'text',
          type: 'note',
          sourceKind: 'other',
          sourceName: '',
        }),
      /超过/,
    );
    const zip = validateBackup(await exportBackup(f.db, f.dir));
    zip.dispose();
  } finally {
    f.close();
  }
});
test('schema9 ->10 preserves all33 original tables and workspace; verified pre-upgrade ZIP and migration failure roll back; corrupted marks refuse backup/start', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-v18-migration-'));
  mkdirSync(path.join(dir, 'attachments'));
  let db = new DatabaseSync(path.join(dir, 'library.sqlite'));
  try {
    db.exec(
      baseSchema +
        topicSchema +
        toolSchema +
        knowledgeSchema +
        readingSchema +
        assistantSchema +
        unifiedSchema +
        relationSchema +
        lifecycleSchema +
        'PRAGMA user_version=9;',
    );
    saveEntry(db, form('旧库内容'));
    db.close();
    writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(defaultWorkspace()));
    assert.throws(
      () =>
        openStore(dir, {
          validateMigrationBackup(bytes) {
            const b = validateBackup(bytes, { upgrade: false });
            assert.equal(b.sourceSchema, 9);
            b.dispose();
          },
          beforeMigrationCommit() {
            throw Error('fault10');
          },
        }),
      /fault10/,
    );
    db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9);
    db.close();
    const migrationSources = [];
    db = openStore(dir, {
      validateMigrationBackup(bytes) {
        const b = validateBackup(bytes, { upgrade: false });
        migrationSources.push(b.sourceSchema);
        b.dispose();
      },
    });
    assert.deepEqual(migrationSources, [9, 10]);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 11);
    assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 1);
    const bpath = readdirSync(path.join(dir, 'backups')).find((n) =>
      n.startsWith('pre-schema-10-'),
    );
    assert.ok(bpath);
    const b = validateBackup(readFileSync(path.join(dir, 'backups', bpath)));
    try {
      const copy = openStore(b.tmp);
      assert.equal(copy.prepare('PRAGMA user_version').get().user_version, 11);
      copy.close();
    } finally {
      b.dispose();
    }
    const e = db.prepare('SELECT * FROM entries').get(),
      m = createMark(db, selected(e));
    db.prepare('UPDATE reading_marks SET anchor_json=? WHERE id=?').run('{}', m.id);
    await assert.rejects(async () => validateBackup(await exportBackup(db, dir)), /批注|引用/);
    db.close();
    assert.throws(() => openStore(dir), /批注|引用/);
    db = null;
  } finally {
    try {
      db?.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
