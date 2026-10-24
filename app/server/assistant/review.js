import { unifiedVersion, saveDomain, domainTree, validateUnified } from '../unified.js';
import { randomUUID } from 'node:crypto';
import { readWorkspace } from '../workspace.js';
import { transaction, saveDirectory, directories, validateTree } from '../knowledge/store.js';
import { attach, validateStructure } from '../knowledge/structure.js';
import { resolve, hash } from './catalog.js';
import { validateSchema } from '../ai/schema.js';
import { prepareAssistant } from '../ai/assistant.js';
import { cleanContent } from '../store.js';
import { validateSources, validateTopicBackup } from '../topics.js';
import { validateKnowledgeBackup } from '../knowledge/store.js';
export const reviewTables = [
  'domains',
  'tags',
  'collections',
  'knowledge_directories',
  'knowledge_records',
  'knowledge_structure',
  'entry_domains',
  'entry_tags',
  'entry_collections',
  'collection_documents',
  'collection_versions',
  'collection_drafts',
];
const additionalReviewTables = [
  'domain_structure',
  'content_primary_domains',
  'collection_rules',
  'library_views',
];
const currentReviewTables = (db) => [
  ...reviewTables,
  ...(unifiedVersion(db) ? additionalReviewTables : []),
];
const snapshot = (db) =>
  Object.fromEntries(
    currentReviewTables(db).map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
const stateHash = (db) =>
  hash(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='assistant_changes' ORDER BY name",
      )
      .all()
      .map((r) => [
        r.name,
        db
          .prepare(
            `SELECT * FROM ${r.name} ORDER BY ${db
              .prepare('PRAGMA table_info(' + r.name + ')')
              .all()
              .map((c) => c.name)
              .join(',')}`,
          )
          .all(),
      ]),
  );
const checkName = (name) => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 50)
    throw Error('名称必填，最多50字。');
  return name.trim();
};
function merge(db, dir, a, b) {
  if (a.kind !== b.kind || a.id === b.id || a.kind === 'entries')
    throw Error('仅能合并同类的不同分类对象。');
  const payloads = [
    JSON.stringify(readWorkspace(dir)),
    ...db
      .prepare('SELECT payload FROM knowledge_drafts')
      .all()
      .map((r) => r.payload),
  ];
  if (payloads.some((v) => v.includes(a.id)))
    throw Error('草稿仍引用源对象，请先保存或处理草稿再合并。');
  if (a.kind === 'directories') {
    db.prepare(
      'UPDATE knowledge_records SET directory_id=?,revision=revision+1 WHERE directory_id=?',
    ).run(b.id, a.id);
    db.prepare('UPDATE knowledge_directories SET parent_id=? WHERE parent_id=?').run(b.id, a.id);
    db.prepare('DELETE FROM knowledge_directories WHERE id=?').run(a.id);
    validateTree(directories(db));
    return;
  }
  if (unifiedVersion(db)) {
    if (a.kind === 'domains') {
      db.prepare('UPDATE content_primary_domains SET domain_id=? WHERE domain_id=?').run(
        b.id,
        a.id,
      );
      db.prepare('UPDATE domain_structure SET parent_id=? WHERE parent_id=?').run(b.id, a.id);
      db.prepare('DELETE FROM domain_structure WHERE domain_id=?').run(a.id);
    }
    if (a.kind === 'collections') {
      const rules = db
        .prepare('SELECT rules_json FROM collection_rules WHERE collection_id IN (?,?)')
        .all(a.id, b.id);
      if (rules.length > 1 && rules[0].rules_json !== rules[1].rules_json)
        throw Error('专题动态规则不同，请先人工处理，未合并。');
      if (rules.length)
        db.prepare(
          'INSERT INTO collection_rules VALUES(?,?,?) ON CONFLICT(collection_id) DO NOTHING',
        ).run(b.id, rules[0].rules_json, new Date().toISOString());
    }
    for (const [t, column, pk] of [
      ['collection_rules', 'rules_json', 'collection_id'],
      ['library_views', 'filters_json', 'id'],
    ])
      for (const row of db.prepare('SELECT * FROM ' + t).all()) {
        const rule = JSON.parse(row[column]);
        const k = a.kind;
        if (Array.isArray(rule[k]) && rule[k].includes(a.id)) {
          rule[k] = [...new Set(rule[k].map((id) => (id === a.id ? b.id : id)))];
          db.prepare('UPDATE ' + t + ' SET ' + column + '=? WHERE ' + pk + '=?').run(
            JSON.stringify(rule),
            row[pk],
          );
        }
      }
  }
  db.prepare(
    `INSERT OR IGNORE INTO entry_${a.kind} SELECT entry_id,? FROM entry_${a.kind} WHERE taxonomy_id=?`,
  ).run(b.id, a.id);
  if (a.kind === 'collections') {
    if (
      db
        .prepare('SELECT collection_id FROM collection_drafts WHERE collection_id IN (?,?)')
        .get(a.id, b.id)
    )
      throw Error('专题存在未保存草稿，请先处理后再合并。');
    const source = db.prepare('SELECT * FROM collection_documents WHERE collection_id=?').get(a.id),
      target = db.prepare('SELECT * FROM collection_documents WHERE collection_id=?').get(b.id);
    const now = new Date().toISOString();
    const sources = new Map();
    for (const s of [
      ...JSON.parse(target?.sources_json || '[]'),
      ...JSON.parse(source?.sources_json || '[]'),
    ]) {
      const old = sources.get(s.id);
      if (old && old.hash !== s.hash) throw Error('专题引用存在不同版本，请先核对来源再合并。');
      sources.set(s.id, s);
    }
    for (const [r, title] of [
      [target, b.name],
      [source, a.name],
    ])
      if (r)
        db.prepare('INSERT INTO collection_versions VALUES(?,?,?,?,?,?,?,?)').run(
          randomUUID(),
          b.id,
          title,
          r.introduction,
          r.content,
          r.sources_json,
          r.revision,
          r.updated_at || now,
        );
    db.prepare('UPDATE collection_versions SET collection_id=? WHERE collection_id=?').run(
      b.id,
      a.id,
    );
    if (source) {
      const title = a.name.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
      const content = cleanContent(
          (target?.content || '') + '<h2>' + title + '</h2>' + source.content,
        ),
        introduction = [target?.introduction, source.introduction].filter(Boolean).join('\n');
      if (introduction.length > 2000 || content.length > 1000000)
        throw Error('合并正文超过保存限制，请先人工整理。');
      db.prepare(
        'INSERT INTO collection_documents VALUES(?,?,?,?,?,?) ON CONFLICT(collection_id) DO UPDATE SET introduction=excluded.introduction,content=excluded.content,sources_json=excluded.sources_json,revision=excluded.revision,updated_at=excluded.updated_at',
      ).run(
        b.id,
        introduction,
        content,
        JSON.stringify([...sources.values()]),
        (target?.revision || 0) + 1,
        now,
      );
    }
  }
  db.prepare(`DELETE FROM ${a.kind} WHERE id=?`).run(a.id);
  if (unifiedVersion(db)) validateUnified(db);
}
export function applyOperation(db, dir, s) {
  if (s.action === 'keep') return;
  if (s.action === 'create') {
    if (!['domains', 'tags', 'collections', 'directories'].includes(s.kind))
      throw Error('创建只能是明确确认的分类或目录。');
    const name = checkName(s.name);
    if (s.kind === 'directories') {
      const p = s.target ? resolve(db, s.target) : null;
      if (p && p.kind !== 'directories') throw Error('父目录类型无效。');
      saveDirectory(db, { name, parent_id: p?.id || null });
    } else db.prepare(`INSERT INTO ${s.kind} VALUES(?,?)`).run(randomUUID(), name);
    return;
  }
  const a = resolve(db, s.object),
    b = s.target ? resolve(db, s.target) : null;
  if (a.kind !== s.kind) throw Error('原对象类型不符。');
  if (s.action === 'rename') {
    const name = checkName(s.name);
    if (a.kind === 'entries') throw Error('请使用知识编辑器修改正文标题。');
    if (a.kind === 'directories') saveDirectory(db, { name, parent_id: a.parent }, a.id);
    else db.prepare(`UPDATE ${a.kind} SET name=? WHERE id=?`).run(name, a.id);
    return;
  }
  if (s.action === 'merge') {
    if (!b) throw Error('请选择合并目标。');
    merge(db, dir, a, b);
    return;
  }
  if (s.action === 'move') {
    if (a.kind === 'domains' && unifiedVersion(db)) {
      if (b && b.kind !== 'domains') throw Error('目标必须是领域。');
      saveDomain(db, { name: a.name, parent_id: b?.id || null }, a.id);
      return;
    }
    if (a.kind === 'directories') {
      if (b && b.kind !== 'directories') throw Error('目标必须是目录。');
      saveDirectory(db, { name: a.name, parent_id: b?.id || null }, a.id);
    } else if (a.kind === 'entries') {
      if (!db.prepare('SELECT entry_id FROM knowledge_records WHERE entry_id=?').get(a.id))
        throw Error('只有知识对象可移动目录或章节。');
      if (b?.kind === 'directories')
        db.prepare(
          'UPDATE knowledge_records SET directory_id=?,revision=revision+1 WHERE entry_id=?',
        ).run(b.id, a.id);
      else if (b?.kind === 'entries') attach(db, { items: [{ id: a.id, parent_id: b.id }] });
      else throw Error('请选择明确目录或页面/章节。');
    } else throw Error('此类对象不支持移动。');
    return;
  }
  if (s.action === 'associate') {
    if (a.kind !== 'entries' || !b || !['domains', 'tags', 'collections'].includes(b.kind))
      throw Error('关联必须从资源到已有领域、标签或专题。');
    db.prepare(`INSERT OR IGNORE INTO entry_${b.kind} VALUES(?,?)`).run(a.id, b.id);
    return;
  }
  throw Error('未知操作，未执行。');
}
export function changePreview(db, s) {
  const a = s.object ? resolve(db, s.object) : null,
    b = s.target ? resolve(db, s.target) : null;
  return {
    before: a
      ? {
          id: a.id,
          key: a.key,
          name: a.name,
          parent: a.parent,
          directory: a.directory || null,
          count: a.count,
        }
      : null,
    after: { action: s.action, name: s.name, target: b ? { key: b.key, name: b.name } : null },
    affected: a?.count || 0,
    targetAffected: b?.count || 0,
    contentChange: s.action === 'merge' && s.kind === 'collections',
    relationChange: ['merge', 'move', 'associate'].includes(s.action),
    reason: s.reason,
    evidenceIds: s.evidenceIds,
  };
}
export function createAssistantReview(getDb, ai, dir, { beforeCommit } = {}) {
  const pending = new Map();
  const currentState = () => hash([stateHash(getDb()), readWorkspace(dir)]);
  const expire = () => {
    for (const [k, r] of pending) if (Date.now() - r.at > 900000) pending.delete(k);
  };
  const recheck = (p) => {
    for (const s of p.snapshots)
      if (resolve(getDb(), s.key).hash !== s.hash)
        throw Error('资料或实际归属已变化，请重新检索/审核，未写入。');
  };
  return {
    estimate(input) {
      const p = prepareAssistant(getDb(), input),
        s = ai.status();
      return {
        chars: p.chars,
        tokens: p.estimatedTokens,
        estimatedUSD: (p.estimatedTokens * s.prices.input) / 1000000,
        provider: s.provider,
        model: s.model,
        insufficient: p.insufficient,
        maxChars: 12000,
      };
    },
    async generate(input, signal) {
      expire();
      if (pending.size >= 8) throw Error('待审核过多，请关闭旧方案。');
      const p = prepareAssistant(getDb(), input),
        result = await ai.suggest(input, signal);
      recheck(p);
      if (input.mode === 'assistant_qa')
        return { ...result, sources: p.payload.sources.map(({ text, ...s }) => s) };
      if (result.suggestion.status !== 'ready') return result;
      const token = randomUUID();
      pending.set(token, { p, at: Date.now(), state: currentState() });
      return { ...result, token, sources: p.payload.sources.map(({ text, ...s }) => s) };
    },
    preview(input) {
      expire();
      const r = pending.get(input.token);
      if (!r) throw Error('审核过期，请重新生成。');
      recheck(r.p);
      validateSchema(input.plan, r.p.schema);
      if (
        !Array.isArray(input.selected) ||
        input.selected.length > 20 ||
        new Set(input.selected).size !== input.selected.length
      )
        throw Error('审核选择无效。');
      return {
        changes: input.selected.map((i) => {
          if (!Number.isInteger(i) || !input.plan.suggestions[i]) throw Error('选择不属于方案。');
          return changePreview(getDb(), input.plan.suggestions[i]);
        }),
        state: currentState(),
        reviewHash: hash([input.plan, input.selected]),
      };
    },
    apply(input) {
      const preview = this.preview(input),
        r = pending.get(input.token);
      if (
        input.confirm !== '采用结构变更' ||
        input.reviewHash !== preview.reviewHash ||
        input.state !== preview.state ||
        r.state !== preview.state
      )
        throw Error('状态已变化或未明确确认，请重新审核。');
      const selected = input.selected.map((i) => input.plan.suggestions[i]);
      if (selected.some((s) => s.action === 'merge') && input.mergeConfirm !== '合并分类并保留引用')
        throw Error('合并须明确确认，原内容和引用将保留。');
      if (!selected.length) throw Error('请选择建议。');
      const db = getDb(),
        before = snapshot(db);
      if (Buffer.byteLength(JSON.stringify(before)) > 5000000)
        throw Error(
          '结构恢复快照超过5MB，请先导出完整备份并使用原手工分类管理。本次未更改，不需要删除知识。',
        );
      const out = transaction(db, () => {
        for (const s of selected) applyOperation(db, dir, s);
        validateTree(directories(db));
        validateStructure(db);
        beforeCommit?.();
        const id = randomUUID();
        db.prepare('INSERT INTO assistant_changes VALUES(?,?,?,?,?)').run(
          id,
          JSON.stringify(before),
          currentState(),
          JSON.stringify(preview.changes),
          new Date().toISOString(),
        );
        return { id, count: selected.length };
      });
      pending.delete(input.token);
      return out;
    },
    cancel(input) {
      pending.delete(input.token);
      return { ok: true };
    },
    history() {
      return getDb()
        .prepare(
          'SELECT id,changes_json,created_at FROM assistant_changes ORDER BY created_at DESC LIMIT 30',
        )
        .all()
        .map((r) => ({ ...r, changes: JSON.parse(r.changes_json) }));
    },
    restore(input) {
      const db = getDb(),
        r = db.prepare('SELECT * FROM assistant_changes WHERE id=?').get(input.id);
      if (!r || input.confirm !== '恢复结构变更' || currentState() !== r.after_hash)
        throw Error('知识库在该操作后已变化，不能覆盖恢复；请使用备份或手工调整。');
      validateAssistantBackup(db);
      const before = JSON.parse(r.before_json);
      return transaction(db, () => {
        db.exec('PRAGMA defer_foreign_keys=ON');
        for (const t of Object.keys(before)) {
          const columns = db
              .prepare('PRAGMA table_info(' + t + ')')
              .all()
              .map((c) => c.name),
            pk = db
              .prepare('PRAGMA table_info(' + t + ')')
              .all()
              .filter((c) => c.pk)
              .map((c) => c.name);
          for (const row of before[t])
            db.prepare(
              `INSERT INTO ${t}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(${pk.join(',')}) DO UPDATE SET ${
                columns.filter((c) => !pk.includes(c)).length
                  ? columns
                      .filter((c) => !pk.includes(c))
                      .map((c) => c + '=excluded.' + c)
                      .join(',')
                  : pk.map((c) => c + '=excluded.' + c).join(',')
              }`,
            ).run(...columns.map((c) => row[c]));
        }
        // Delete only rows introduced by the reviewed change; never delete knowledge_records and its cascading sources.
        for (const t of Object.keys(before).reverse()) {
          const pk = db
            .prepare('PRAGMA table_info(' + t + ')')
            .all()
            .filter((c) => c.pk)
            .map((c) => c.name);
          const keep = new Set(before[t].map((row) => JSON.stringify(pk.map((c) => row[c]))));
          const extra = db
            .prepare('SELECT * FROM ' + t)
            .all()
            .filter((row) => !keep.has(JSON.stringify(pk.map((c) => row[c]))));
          for (const row of extra) {
            if (t === 'knowledge_records') throw Error('恢复不能删除新增知识。');
            db.prepare(`DELETE FROM ${t} WHERE ${pk.map((c) => c + '=?').join(' AND ')}`).run(
              ...pk.map((c) => row[c]),
            );
          }
        }
        validateTree(directories(db));
        validateStructure(db);
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('恢复关系校验失败。');
        validateTopicBackup(db, db.prepare('SELECT * FROM assets').all());
        validateKnowledgeBackup(db);
        validateUnified(db);
        for (const t of ['domains', 'tags', 'collections'])
          for (const row of db.prepare('SELECT name FROM ' + t).all()) checkName(row.name);
        db.prepare('DELETE FROM assistant_changes WHERE id=?').run(r.id);
        return { ok: true };
      });
    },
  };
}
export function validateAssistantBackup(db) {
  if (db.prepare('PRAGMA user_version').get().user_version < 6) return;
  for (const r of db.prepare('SELECT * FROM assistant_changes').all()) {
    if (
      !/^[a-f0-9]{64}$/.test(r.after_hash) ||
      !Number.isFinite(Date.parse(r.created_at)) ||
      Buffer.byteLength(r.before_json) > 5000000
    )
      throw Error('结构历史无效。');
    const data = JSON.parse(r.before_json);
    if (
      ![reviewTables, currentReviewTables(db)].some(
        (ts) => Object.keys(data).sort().join() === [...ts].sort().join(),
      ) ||
      Object.keys(data).some((t) => !Array.isArray(data[t]) || data[t].length > 20000)
    )
      throw Error('结构历史表无效。');
    for (const t of Object.keys(data)) {
      const columns = db
        .prepare('PRAGMA table_info(' + t + ')')
        .all()
        .map((c) => c.name)
        .sort();
      for (const row of data[t]) {
        if (!row || Object.keys(row).sort().join() != columns.join())
          throw Error('结构历史字段无效。');
        if (Object.hasOwn(row, 'content')) {
          if (typeof row.content !== 'string' || cleanContent(row.content) !== row.content)
            throw Error('结构历史正文不安全。');
          for (const image of row.content.matchAll(/src="\/assets\/([^"]+)"/g))
            if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(image[1]))
              throw Error('结构历史图片缺失。');
        }
        if (row.sources_json) validateSources(JSON.parse(row.sources_json));
      }
    }
    validateTree(data.knowledge_directories);
    if (data.domain_structure) {
      const nodes = new Map(
        data.domains.map((d) => [d.id, { ...d, parent_id: null, position: 0 }]),
      );
      for (const r of data.domain_structure) {
        if (!nodes.has(r.domain_id) || !Number.isSafeInteger(r.position) || r.position < 0)
          throw Error('领域历史排序无效。');
        nodes.get(r.domain_id).parent_id = r.parent_id;
      }
      validateTree([...nodes.values()]);
      for (const r of data.content_primary_domains)
        if (
          !data.entry_domains.some(
            (link) => link.entry_id === r.entry_id && link.taxonomy_id === r.domain_id,
          )
        )
          throw Error('历史主要领域不匹配。');
      for (const [table, column] of [
        ['collection_rules', 'rules_json'],
        ['library_views', 'filters_json'],
      ])
        for (const row of data[table]) {
          const rule = JSON.parse(row[column]);
          if (!rule || Object.keys(rule).sort().join() !== 'domains,tags,types')
            throw Error('历史规则格式无效。');
          for (const k of ['domains', 'tags', 'types'])
            if (
              !Array.isArray(rule[k]) ||
              rule[k].length > 20 ||
              new Set(rule[k]).size !== rule[k].length
            )
              throw Error('历史规则条件无效。');
          for (const k of ['domains', 'tags'])
            if (rule[k].some((id) => !data[k].some((r) => r.id === id)))
              throw Error('历史规则引用缺失。');
          if (rule.types.some((t) => !['note', 'bookmark', 'tool', 'document'].includes(t)))
            throw Error('历史规则内容类型无效。');
          if (
            table === 'library_views' &&
            (!Number.isSafeInteger(row.position) ||
              row.position < 0 ||
              typeof row.name !== 'string' ||
              !row.name.trim() ||
              row.name.length > 50)
          )
            throw Error('历史快捷视图无效。');
        }
    }
    if (!Array.isArray(JSON.parse(r.changes_json))) throw Error('结构历史差异无效。');
  }
}
