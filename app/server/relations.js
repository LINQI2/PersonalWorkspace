import { visibleSql, lifecycle, lifecycleVersion } from './lifecycle.js';
import { spaceSql,isProfessional } from './space.js';
import { randomUUID, createHash } from 'node:crypto';
import { readingText } from '../shared/reading-anchor.js';
import { transaction } from './knowledge/store.js';
import { owner } from './knowledge/structure.js';
import { domainScope, ruleMembers } from './unified.js';
export const relationTypes = [
  'reference',
  'complement',
  'conflict',
  'revision',
  'dependency',
  'composition',
  'related',
];
export const relationVersion = (db) => db.prepare('PRAGMA user_version').get().user_version >= 8;
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function node(db, id) {
  const r = db
    .prepare(
      'SELECT e.id,e.title,e.type,e.resource_kind,k.kind FROM entries e LEFT JOIN knowledge_records k ON k.entry_id=e.id WHERE e.id=?',
    )
    .get(id);
  if (!r) throw Error('关联目标不存在。');
  if (lifecycle(db, id)?.state === 'trash') throw Error('内容在回收站，请先恢复后关联或探索。');
  return {
    ...r,
    space:isProfessional(db,id)?'professional':'personal',
    type:
      db.prepare('PRAGMA user_version').get().user_version >= 11 &&
      db.prepare('SELECT entry_id FROM mindmaps WHERE entry_id=?').get(id)
        ? 'mindmap'
        : r.kind === 'page'
          ? 'document'
          : r.kind === 'point'
            ? 'block'
            : r.resource_kind === 'tool'
              ? 'tool'
              : r.type,
    pageId: r.kind ? owner(db, id) : null,
    anchor: r.kind === 'point' ? 'chapter-' + id : null,
  };
}
const legacyType = (k) => (['complement', 'conflict', 'revision'].includes(k) ? k : 'related');
export function edges(db) {
  const detailed = relationVersion(db) ? db.prepare('SELECT * FROM relation_details').all() : [];
  const details = new Map(detailed.map((d) => [d.relation_id, d]));
  const out = db
    .prepare('SELECT * FROM knowledge_relations ORDER BY created_at,id')
    .all()
    .map((r) => {
      const d = details.get(r.id);
      return {
        ...r,
        type: d?.relation_type || legacyType(r.kind),
        origin: d?.origin || 'legacy',
        evidence: d ? JSON.parse(d.evidence_json) : [],
        uncertainty: d?.uncertainty || '历史关系方向和依据需人工核对',
        revision: d?.revision || 0,
        version: hash([r, d || null]),
        system: false,
      };
    });
  const add = (from, to, type, reason, key) => {
    if (from !== to && db.prepare('SELECT id FROM entries WHERE id=?').get(to))
      out.push({
        id: 'system:' + key,
        from_id: from,
        to_id: to,
        type,
        origin: 'system',
        state: 'confirmed',
        note: reason,
        evidence: [],
        uncertainty: '仅确定性记录，不证明观点正确',
        revision: 0,
        system: true,
      });
  };
  for (const r of db.prepare('SELECT * FROM knowledge_structure').all())
    add(
      r.entry_id,
      r.parent_id,
      'composition',
      '明确章节父级（调整归属请使用文档整理模式）',
      r.entry_id,
    );
  for (const r of db.prepare('SELECT * FROM knowledge_references').all())
    add(
      r.page_id,
      r.target_id,
      'reference',
      '用户在文档中选择的资源引用',
      r.page_id + ':' + r.target_id,
    );
  for (const e of db
    .prepare("SELECT id,content FROM entries WHERE content LIKE '%data-entry-id%' ")
    .all())
    for (const m of e.content.matchAll(/data-entry-id="([a-f0-9-]{36})"/g))
      add(e.id, m[1], 'reference', '正文内明确站内链接', e.id + ':' + m[1]);
  if (db.prepare('PRAGMA user_version').get().user_version >= 10)
    for (const m of db
      .prepare("SELECT * FROM reading_marks WHERE kind='citation' AND deleted_at IS NULL")
      .all()) {
      let edge = out.find(
        (r) =>
          r.system &&
          r.type === 'reference' &&
          r.from_id === m.target_id &&
          r.to_id === m.source_id,
      );
      if (!edge) {
        add(m.target_id, m.source_id, 'reference', '人工摘录引用', 'mark:' + m.id);
        edge = out.at(-1);
      }
      if (edge) {
        edge.note = '人工摘录引用：' + m.quote;
        edge.evidence = [...(edge.evidence || []), { id: m.source_id, quote: m.quote }].slice(
          0,
          10,
        );
        edge.markId = m.id;
      }
    }
  return [...new Map(out.map((r) => [r.id, r])).values()];
}
export function related(db, id) {
  node(db, id);
  return edges(db)
    .filter((r) => r.from_id === id || r.to_id === id)
    .map((r) => ({
      ...r,
      direction: r.from_id === id ? 'outgoing' : 'incoming',
      other: node(db, r.from_id === id ? r.to_id : r.from_id),
    }));
}
export function candidates(db, input = {}) {
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, 200) : '';
  if (input.center) node(db, input.center);
  let domainIds = input.domain ? domainScope(db, input.domain) : null,
    collectionIds = input.collection
      ? [
          ...new Set([
            ...db
              .prepare('SELECT entry_id FROM entry_collections WHERE taxonomy_id=?')
              .all(input.collection)
              .map((r) => r.entry_id),
            ...ruleMembers(db, input.collection),
          ]),
        ]
      : null;
  const where = ['e.id<>?',spaceSql(db,input.space||(isProfessional(db,input.center)?'professional':'personal'))],
    args = [input.center || ''];
  if (q) {
    where.push(
      "(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.plain_text LIKE ? ESCAPE '\\')",
    );
    const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    args.push(term, term, term);
  }
  if (domainIds) {
    where.push(
      'EXISTS(SELECT 1 FROM entry_domains r WHERE r.entry_id=e.id AND taxonomy_id IN (' +
        domainIds.map(() => '?').join(',') +
        '))',
    );
    args.push(...domainIds);
  }
  if (collectionIds) {
    if (!collectionIds.length) return [];
    where.push('e.id IN (' + collectionIds.map(() => '?').join(',') + ')');
    args.push(...collectionIds);
  }
  const center = input.center
    ? db.prepare('SELECT * FROM entries WHERE id=?').get(input.center)
    : null;
  const rows = db
    .prepare(
      'SELECT e.id,e.title,e.description,e.plain_text FROM entries e WHERE ' +
        visibleSql(db) +
        ' AND ' +
        where.join(' AND ') +
        ' ORDER BY e.updated_at DESC LIMIT 200',
    )
    .all(...args);
  return rows
    .map((r) => {
      let score = 0;
      const reasons = [];
      if (center)
        for (const k of ['domains', 'tags', 'collections']) {
          const n = db
            .prepare(
              `SELECT count(*) n FROM entry_${k} a JOIN entry_${k} b ON a.taxonomy_id=b.taxonomy_id WHERE a.entry_id=? AND b.entry_id=?`,
            )
            .get(center.id, r.id).n;
          if (n) {
            score += n;
            reasons.push(
              '共同' + { domains: '领域', tags: '标签', collections: '专题' }[k] + ' ' + n + '项',
            );
          }
        }
      if (q) {
        score += 2;
        reasons.push('本地标题/简介/正文命中');
      }
      return {
        ...node(db, r.id),
        excerpt: (r.description + ' ' + r.plain_text).slice(0, 240),
        score,
        reasons: reasons.length ? reasons : ['最近更新候选，不表示已有关联'],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
}
export function graph(db, input) {
  node(db, input.id);
  const depth = Number(input.depth || 1);
  if (
    ![1, 2].includes(depth) ||
    !Array.isArray(input.types) ||
    input.types.some((t) => !relationTypes.includes(t))
  )
    throw Error('地图筛选无效。');
  const eligible = edges(db).filter(
    (r) =>
      (!input.types.length || input.types.includes(r.type)) &&
      (input.candidates === true || r.state === 'confirmed'),
  );
  const seen = new Set([input.id]),
    chosen = new Map();
  let frontier = [input.id],
    omitted = 0;
  for (let n = 0; n < depth; n++) {
    const next = [];
    for (const r of eligible) {
      if (!frontier.includes(r.from_id) && !frontier.includes(r.to_id)) continue;
      const ids = [r.from_id, r.to_id];
      for (const id of ids)
        if (!seen.has(id)) {
          if (seen.size >= 40) {
            omitted++;
            continue;
          }
          seen.add(id);
          next.push(id);
        }
      if (ids.every((id) => seen.has(id)) && chosen.size < 80) chosen.set(r.id, r);
      else omitted++;
    }
    frontier = next;
  }
  return {
    center: input.id,
    nodes: [...seen].map((id) => node(db, id)),
    edges: [...chosen.values()],
    omitted,
    notice: '最多40真实节点/80连线；省略数量仅为遍历触及上限的计数，不生成虚构聚合节点。',
  };
}
function validated(db, p, origin, state) {
  if (
    !p ||
    typeof p.from_id !== 'string' ||
    typeof p.to_id !== 'string' ||
    p.from_id === p.to_id ||
    !relationTypes.includes(p.type) ||
    typeof p.note !== 'string' ||
    !p.note.trim() ||
    p.note.length > 1000 ||
    typeof (p.uncertainty ?? '') !== 'string' ||
    (p.uncertainty || '').length > 1000
  )
    throw Error('关系类型、端点或依据无效，不能自引用。');
  node(db, p.from_id);
  node(db, p.to_id);
  const evidence = p.evidence || [];
  if (!Array.isArray(evidence) || evidence.length > 10) throw Error('证据范围无效。');
  for (const e of evidence) {
    if (
      !e ||
      ![p.from_id, p.to_id].includes(e.id) ||
      typeof e.quote !== 'string' ||
      !e.quote ||
      e.quote.length > 2000
    )
      throw Error('引用不属于端点资料。');
    const r = db
      .prepare('SELECT title,description,plain_text,content FROM entries WHERE id=?')
      .get(e.id);
    if (
      ![r.title, r.description, r.plain_text, readingText(r.content)].some((t) =>
        t.includes(e.quote),
      )
    )
      throw Error('引用摘录不属于实际资料。');
  }
  const all = edges(db).filter((r) => r.id !== p.id);
  if (
    all.some(
      (r) =>
        r.type === p.type &&
        ((r.from_id === p.from_id && r.to_id === p.to_id) ||
          (['conflict', 'related'].includes(p.type) &&
            r.from_id === p.to_id &&
            r.to_id === p.from_id)),
    )
  )
    throw Error('相同关系已存在（含确定性关系），请编辑或核对已有记录。');
  if (['dependency', 'composition', 'revision'].includes(p.type)) {
    const next = [p.to_id],
      seen = new Set();
    while (next.length) {
      const id = next.pop();
      if (id === p.from_id) throw Error('依赖、组成或修正关系不能形成循环。');
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of all) if (r.type === p.type && r.from_id === id) next.push(r.to_id);
    }
  }
  return { ...p, origin, state, evidence, uncertainty: p.uncertainty || '' };
}
const carrier = (t) => (['complement', 'conflict', 'revision'].includes(t) ? t : 'parent');
export function writeRelation(db, p, { origin = 'manual', state = 'confirmed' } = {}) {
  const r = validated(db, p, origin, state),
    id = p.id || randomUUID();
  if (p.id) {
    const old = db.prepare('SELECT * FROM relation_details WHERE relation_id=?').get(p.id);
    const original = db.prepare('SELECT * FROM knowledge_relations WHERE id=?').get(p.id);
    if (
      !original ||
      (old?.revision || 0) !== p.revision ||
      p.version !== hash([original, old || null])
    )
      throw Error('关联已变化，不能覆盖。');
    origin = old?.origin || origin;
    db.prepare(
      'UPDATE knowledge_relations SET from_id=?,to_id=?,kind=?,state=?,note=? WHERE id=?',
    ).run(p.from_id, p.to_id, carrier(p.type), state, p.note, id);
  } else
    db.prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)').run(
      id,
      p.from_id,
      p.to_id,
      carrier(p.type),
      state,
      p.note,
      new Date().toISOString(),
    );
  db.prepare(
    'INSERT INTO relation_details VALUES(?,?,?,?,?,?) ON CONFLICT(relation_id) DO UPDATE SET relation_type=excluded.relation_type,origin=excluded.origin,evidence_json=excluded.evidence_json,uncertainty=excluded.uncertainty,revision=relation_details.revision+1',
  ).run(id, p.type, origin, JSON.stringify(r.evidence), r.uncertainty, 1);
  return { id };
}
const snapshot = (db) => ({
  relations: db.prepare('SELECT * FROM knowledge_relations ORDER BY id').all(),
  details: db.prepare('SELECT * FROM relation_details ORDER BY relation_id').all(),
});
const stateHash = (db) =>
  hash([
    snapshot(db),
    db.prepare('SELECT id,title,content,description,updated_at FROM entries ORDER BY id').all(),
    db.prepare('SELECT * FROM knowledge_structure ORDER BY entry_id').all(),
    ...(lifecycleVersion(db) && db.prepare('SELECT count(*) n FROM content_lifecycle').get().n
      ? [db.prepare('SELECT * FROM content_lifecycle ORDER BY entry_id').all()]
      : []),
  ]);
export function changeRelations(db, fn, { beforeCommit } = {}) {
  return transaction(db, () => {
    const before = snapshot(db);
    if (Buffer.byteLength(JSON.stringify(before)) > 2000000 || before.relations.length > 10000)
      throw Error('关系恢复快照超过安全上限，请导出备份后人工调整；本次未改变。');
    const result = fn();
    validateRelations(db);
    beforeCommit?.();
    db.prepare('INSERT INTO relation_history VALUES(?,?,?,?)').run(
      randomUUID(),
      JSON.stringify(before),
      stateHash(db),
      new Date().toISOString(),
    );
    return result;
  });
}
export function reviewRelation(db, input) {
  return changeRelations(db, () => {
    const r = db.prepare('SELECT * FROM knowledge_relations WHERE id=?').get(input.id);
    if (!r) throw Error('关系不存在或为只读确定性关系。');
    if (input.action === 'reject')
      db.prepare('DELETE FROM knowledge_relations WHERE id=?').run(r.id);
    else if (input.action === 'confirm' && input.confirm === '确认关系') {
      const detail = db.prepare('SELECT * FROM relation_details WHERE relation_id=?').get(r.id);
      if (detail)
        validated(
          db,
          {
            ...r,
            id: r.id,
            type: detail.relation_type,
            evidence: JSON.parse(detail.evidence_json),
            uncertainty: detail.uncertainty,
          },
          detail.origin,
          'confirmed',
        );
      db.prepare("UPDATE knowledge_relations SET state='confirmed' WHERE id=?").run(r.id);
      if (detail)
        db.prepare('UPDATE relation_details SET revision=revision+1 WHERE relation_id=?').run(r.id);
    } else throw Error('请明确确认或拒绝候选关系。');
    return { ok: true };
  });
}
export function restoreRelations(db, id) {
  const r = db.prepare('SELECT * FROM relation_history WHERE id=?').get(id);
  if (!r || stateHash(db) !== r.after_hash) throw Error('关系或原内容已变化，不能覆盖恢复。');
  return transaction(db, () => {
    const p = JSON.parse(r.before_json);
    db.prepare('DELETE FROM relation_details').run();
    db.prepare('DELETE FROM knowledge_relations').run();
    for (const row of p.relations)
      db.prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)').run(
        row.id,
        row.from_id,
        row.to_id,
        row.kind,
        row.state,
        row.note,
        row.created_at,
      );
    for (const row of p.details)
      db.prepare('INSERT INTO relation_details VALUES(?,?,?,?,?,?)').run(
        row.relation_id,
        row.relation_type,
        row.origin,
        row.evidence_json,
        row.uncertainty,
        row.revision,
      );
    validateRelations(db);
    db.prepare('DELETE FROM relation_history WHERE id=?').run(id);
    return { ok: true };
  });
}
export function checkDelete(db, ids) {
  if (!relationVersion(db)) return;
  if (db.prepare('PRAGMA user_version').get().user_version >= 10)
    for (const id of ids)
      if (
        db
          .prepare(
            'SELECT id FROM reading_marks WHERE deleted_at IS NULL AND (source_id=? OR target_id=? OR source_page_id=?) LIMIT 1',
          )
          .get(id, id, id)
      )
        throw Error('内容仍有批注或摘录引用，请先处理，未删除原文。');
  const all = edges(db);
  for (const id of ids)
    if (
      all.some((r) =>
        !r.system
          ? r.from_id === id || r.to_id === id
          : r.type === 'reference' && (r.from_id === id || r.to_id === id),
      )
    )
      throw Error('内容仍有知识关联或明确引用，请先查看相关知识并移除关系/正文引用；未删除内容。');
}
export function validateRelations(db) {
  if (!relationVersion(db)) return;
  const detailValid = (d, r) => {
    if (
      !r ||
      typeof r.note !== 'string' ||
      !r.note.trim() ||
      r.note.length > 1000 ||
      r.kind !== carrier(d.relation_type) ||
      !relationTypes.includes(d.relation_type) ||
      !['manual', 'ai', 'import'].includes(d.origin) ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 1 ||
      typeof d.uncertainty !== 'string' ||
      d.uncertainty.length > 1000
    )
      throw Error('关联详情或历史元数据无效。');
    const evidence = JSON.parse(d.evidence_json);
    if (
      !Array.isArray(evidence) ||
      evidence.length > 10 ||
      evidence.some(
        (e) =>
          !e ||
          Object.keys(e).sort().join() !== 'id,quote' ||
          ![r.from_id, r.to_id].includes(e.id) ||
          typeof e.quote !== 'string' ||
          !e.quote ||
          e.quote.length > 2000,
      )
    )
      throw Error('关联证据范围或历史快照无效。');
  };
  for (const d of db.prepare('SELECT * FROM relation_details').all()) {
    detailValid(d, db.prepare('SELECT * FROM knowledge_relations WHERE id=?').get(d.relation_id));
    if (
      !relationTypes.includes(d.relation_type) ||
      !['manual', 'ai', 'import'].includes(d.origin) ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 1 ||
      d.uncertainty.length > 1000
    )
      throw Error('关联元数据无效。');
    const evidence = JSON.parse(d.evidence_json);
    if (
      !Array.isArray(evidence) ||
      evidence.length > 10 ||
      evidence.some(
        (e) =>
          !e || typeof e.id !== 'string' || typeof e.quote !== 'string' || e.quote.length > 2000,
      )
    )
      throw Error('关联证据快照无效。');
  }
  const typed = db
    .prepare(
      'SELECT r.from_id,r.to_id,d.relation_type type FROM knowledge_relations r JOIN relation_details d ON d.relation_id=r.id',
    )
    .all();
  for (const type of ['dependency', 'composition', 'revision']) {
    const links = typed.filter((r) => r.type === type);
    if (type === 'composition')
      links.push(
        ...db.prepare('SELECT entry_id from_id,parent_id to_id FROM knowledge_structure').all(),
      );
    const ids = new Set(links.flatMap((r) => [r.from_id, r.to_id])),
      counts = new Map([...ids].map((id) => [id, 0]));
    for (const r of links) counts.set(r.to_id, counts.get(r.to_id) + 1);
    const queue = [...ids].filter((id) => counts.get(id) === 0);
    let passed = 0;
    for (let i = 0; i < queue.length; i++) {
      passed++;
      for (const r of links)
        if (r.from_id === queue[i]) {
          const count = counts.get(r.to_id) - 1;
          counts.set(r.to_id, count);
          if (count === 0) queue.push(r.to_id);
        }
    }
    if (passed !== ids.size) throw Error('关联组成、依赖或修正存在循环，已拒绝。');
  }
  for (const h of db.prepare('SELECT * FROM relation_history').all()) {
    if (
      !/^[a-f0-9]{64}$/.test(h.after_hash) ||
      Buffer.byteLength(h.before_json) > 2000000 ||
      !Number.isFinite(Date.parse(h.created_at))
    )
      throw Error('关联历史无效。');
    const p = JSON.parse(h.before_json);
    if (
      Object.keys(p).sort().join() !== 'details,relations' ||
      !Array.isArray(p.relations) ||
      !Array.isArray(p.details) ||
      p.relations.length > 10000 ||
      p.details.length > 10000
    )
      throw Error('关联历史快照无效。');
    for (const r of p.relations)
      if (
        Object.keys(r).sort().join() !== 'created_at,from_id,id,kind,note,state,to_id' ||
        r.from_id === r.to_id ||
        typeof r.note !== 'string' ||
        r.note.length > 1000 ||
        !['candidate', 'confirmed'].includes(r.state) ||
        !['parent', 'duplicate', 'complement', 'conflict', 'revision'].includes(r.kind) ||
        typeof r.id !== 'string' ||
        typeof r.from_id !== 'string' ||
        typeof r.to_id !== 'string' ||
        !Number.isFinite(Date.parse(r.created_at))
      )
        throw Error('历史关系无效。');
    if (
      new Set(p.relations.map((r) => r.id)).size !== p.relations.length ||
      new Set(p.details.map((r) => r.relation_id)).size !== p.details.length
    )
      throw Error('关联历史ID重复。');
    for (const d of p.details) {
      if (
        Object.keys(d).sort().join() !==
          'evidence_json,origin,relation_id,relation_type,revision,uncertainty' ||
        !relationTypes.includes(d.relation_type) ||
        !p.relations.some((r) => r.id === d.relation_id) ||
        !Array.isArray(JSON.parse(d.evidence_json))
      )
        throw Error('历史关联详情无效。');
      detailValid(
        d,
        p.relations.find((r) => r.id === d.relation_id),
      );
    }
  }
}
