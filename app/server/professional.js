import { randomUUID } from 'node:crypto';
import { related } from './relations.js';
import { saveRecord, getRecord, transaction, validateTree } from './knowledge/store.js';

export const professionalTables = [
  'professional_domains',
  'professional_entries',
  'professional_entry_domains',
];
export const conceptKinds = ['concept', 'principle', 'method', 'architecture', 'tool', 'case'];
export const professionalSchema = `
CREATE TABLE professional_domains(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES professional_domains(id) ON DELETE RESTRICT,name TEXT NOT NULL,summary TEXT NOT NULL,scope_note TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0),seed_key TEXT UNIQUE);
CREATE TABLE professional_entries(entry_id TEXT PRIMARY KEY REFERENCES knowledge_records(entry_id) ON DELETE RESTRICT,concept_kind TEXT NOT NULL CHECK(concept_kind IN ('concept','principle','method','architecture','tool','case')),aliases_json TEXT NOT NULL,scope_note TEXT NOT NULL,seed_key TEXT UNIQUE);
CREATE TABLE professional_entry_domains(entry_id TEXT NOT NULL REFERENCES professional_entries(entry_id) ON DELETE CASCADE,domain_id TEXT NOT NULL REFERENCES professional_domains(id) ON DELETE RESTRICT,is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),PRIMARY KEY(entry_id,domain_id));
CREATE UNIQUE INDEX professional_primary ON professional_entry_domains(entry_id) WHERE is_primary=1;
`;
export const professionalVersion = (db) =>
  db.prepare('PRAGMA user_version').get().user_version >= 12;
export const personalSql = (db, alias = 'e') =>
  professionalVersion(db)
    ? `NOT EXISTS(SELECT 1 FROM professional_entries pe WHERE pe.entry_id=${alias}.id)`
    : '1';
const text = (v, max) => {
  if (typeof v !== 'string' || v.length > max) throw Error('专业知识字段格式或长度无效。');
  return v;
};
export function professionalDomains(db) {
  return db
    .prepare(
      `SELECT d.*,(SELECT count(*) FROM professional_entry_domains r
    WHERE r.domain_id=d.id AND NOT EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=r.entry_id AND l.state='trash')) count
    FROM professional_domains d ORDER BY position,name,id`,
    )
    .all();
}
export function saveProfessionalDomain(db, input, id) {
  return transaction(db, () => {
    const old = id ? professionalDomains(db).find((d) => d.id === id) : null;
    if (id && !old) throw Error('专业领域不存在。');
    const row = {
      id: id || randomUUID(),
      parent_id: input.parent_id || null,
      name: text(input.name, 50).trim(),
      summary: text(input.summary || '', 2000),
      scope_note: text(input.scope_note || '', 4000),
      position: input.position ?? old?.position ?? 0,
    };
    validateTree([...professionalDomains(db).filter((d) => d.id !== row.id), row]);
    db.prepare(
      `INSERT INTO professional_domains VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET
      parent_id=excluded.parent_id,name=excluded.name,summary=excluded.summary,scope_note=excluded.scope_note,position=excluded.position`,
    ).run(row.id, row.parent_id, row.name, row.summary, row.scope_note, row.position);
    return row;
  });
}
export function validateProfessional(db) {
  if (!professionalVersion(db)) return;
  validateTree(professionalDomains(db));
  for (const r of db.prepare('SELECT * FROM professional_entries').all()) {
    const aliases = JSON.parse(r.aliases_json);
    if (
      !conceptKinds.includes(r.concept_kind) ||
      !Array.isArray(aliases) ||
      aliases.length > 20 ||
      aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > 200)
    )
      throw Error('专业知识别名无效。');
    text(r.scope_note, 4000);
    if (
      db
        .prepare(
          'SELECT count(*) n FROM professional_entry_domains WHERE entry_id=? AND is_primary=1',
        )
        .get(r.entry_id).n !== 1
    )
      throw Error('专业知识必须有且只有一个主要领域。');
    if (db.prepare('SELECT 1 FROM entry_domains WHERE entry_id=?').get(r.entry_id))
      throw Error('专业知识不能写入个人领域。');
  }
}
export function readProfessional(db, id) {
  const meta = db.prepare('SELECT * FROM professional_entries WHERE entry_id=?').get(id);
  if (!meta) throw Error('专业知识不存在。');
  const record=getRecord(db,id);
  return {
    ...record,
    ...meta,
    relations: record.lifecycle?.state==='trash'?[]:related(db,id),
    aliases: JSON.parse(meta.aliases_json),
    space: 'professional',
    professional_domains: db
      .prepare(
        'SELECT d.*,r.is_primary FROM professional_domains d JOIN professional_entry_domains r ON r.domain_id=d.id WHERE r.entry_id=? ORDER BY r.is_primary DESC,d.position',
      )
      .all(id),
  };
}
export function saveProfessional(db, input, id, { outer = false } = {}) {
  const run = () => {
    if (id && !db.prepare('SELECT 1 FROM professional_entries WHERE entry_id=?').get(id))
      throw Error('不能将个人知识隐式转换为专业知识。');
    if (
      !conceptKinds.includes(input.concept_kind) ||
      !Array.isArray(input.aliases) ||
      input.aliases.length > 20 ||
      input.aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > 200)
    )
      throw Error('专业类别或别名无效。');
    if (
      !Array.isArray(input.professional_domains) ||
      !input.professional_domains.length ||
      input.professional_domains.length > 20 ||
      new Set(input.professional_domains).size !== input.professional_domains.length ||
      !input.professional_domains.includes(input.primary_domain)
    )
      throw Error('主要领域必须来自已选专业领域。');
    const e = saveRecord(
      db,
      {
        ...input,
        kind: 'point',
        directory_id: null,
        domains: [],
        tags: [],
        collections: [],
        references: [],
        priority: 0,
        status: input.status || 'draft',
        epistemic: 'reported_fact',
      },
      id,
      { outer: true, professionalWrite: true },
    );
    db.prepare(
      `INSERT INTO professional_entries VALUES(?,?,?,?,NULL) ON CONFLICT(entry_id) DO UPDATE SET
      concept_kind=excluded.concept_kind,aliases_json=excluded.aliases_json,scope_note=excluded.scope_note`,
    ).run(
      e.id,
      input.concept_kind,
      JSON.stringify(input.aliases),
      text(input.scope_note || '', 4000),
    );
    db.prepare('DELETE FROM professional_entry_domains WHERE entry_id=?').run(e.id);
    for (const domain of input.professional_domains)
      db.prepare('INSERT INTO professional_entry_domains VALUES(?,?,?)').run(
        e.id,
        domain,
        Number(domain === input.primary_domain),
      );
    validateProfessional(db);
    db.prepare('DELETE FROM knowledge_drafts WHERE key=?').run('professional:' + (id || 'new'));
    return readProfessional(db, e.id);
  };
  return outer ? run() : transaction(db, run);
}
export function searchProfessional(db, q = {}) {
  if(q.view && !['active','trash'].includes(q.view))throw Error('专业视图无效。');
  const query = text(q.q || '', 200).toLocaleLowerCase();
  const domains = q.domain ? [q.domain] : [];
  const tree = professionalDomains(db);
  for (let i = 0; i < domains.length; i++)
    domains.push(...tree.filter((d) => d.parent_id === domains[i]).map((d) => d.id));
  return db
    .prepare(
      `SELECT e.id,e.title,e.description,e.plain_text,p.concept_kind,p.aliases_json,p.scope_note
    FROM entries e JOIN professional_entries p ON p.entry_id=e.id
    WHERE ${q.view==='trash'?'EXISTS':'NOT EXISTS'}(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id AND l.state='trash') ORDER BY e.title,e.id`,
    )
    .all()
    .filter(
      (e) =>
        (!q.kind || e.concept_kind === q.kind) &&
        (!query ||
          [e.title, e.description, e.plain_text, ...JSON.parse(e.aliases_json)].some((s) =>
            s.toLocaleLowerCase().includes(query),
          )) &&
        (!domains.length ||
          db
            .prepare('SELECT domain_id FROM professional_entry_domains WHERE entry_id=?')
            .all(e.id)
            .some((d) => domains.includes(d.domain_id))),
    )
    .slice(0, 200)
    .map(({ plain_text, aliases_json, ...e }) => ({
      ...e,
      aliases: JSON.parse(aliases_json),
      space: 'professional',
    }));
}
