import { randomUUID, createHash } from 'node:crypto';
import { saveProfessional, professionalDomains, conceptKinds } from './professional.js';
import { transaction, validateSource } from './knowledge/store.js';
import { cleanContent } from './store.js';
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const string = (s, n) => {
  if (typeof s !== 'string' || !s.trim() || s.length > n)
    throw Error('专业导入字段格式或长度无效。');
  return s;
};
export function parseProfessional(raw, db) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 512 * 1024)
    throw Error('专业导入上限512KiB。');
  const p = JSON.parse(raw);
  if (
    p?.format !== 'professional-knowledge-v1' ||
    Object.keys(p).some((k) => !['format', 'entries'].includes(k)) ||
    !Array.isArray(p.entries) ||
    !p.entries.length ||
    p.entries.length > 100
  )
    throw Error('专业导入格式无效，限1～100条。');
  const ids = new Set();
  for (const e of p.entries) {
    if (
      !e ||
      Object.keys(e).some(
        (k) =>
          ![
            'id',
            'title',
            'description',
            'content',
            'concept_kind',
            'aliases',
            'scope_note',
            'professional_domains',
            'primary_domain',
            'sources',
          ].includes(k),
      )
    )
      throw Error('专业条目含未知字段。');
    string(e.id, 100);
    if (ids.has(e.id)) throw Error('专业导入ID重复。');
    ids.add(e.id);
    string(e.title, 200);
    string(e.description, 2000);
    string(e.content, 1_000_000);
    string(e.scope_note, 4000);
    if (
      !conceptKinds.includes(e.concept_kind) ||
      !Array.isArray(e.aliases) ||
      e.aliases.length > 20 ||
      e.aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > 200)
    )
      throw Error('专业类别或别名无效。');
    if (
      !Array.isArray(e.professional_domains) ||
      !e.professional_domains.length ||
      e.professional_domains.length > 20 ||
      new Set(e.professional_domains).size !== e.professional_domains.length ||
      !e.professional_domains.includes(e.primary_domain) ||
      e.professional_domains.some(
        (id) =>
          typeof id !== 'string' ||
          !id ||
          (db && !professionalDomains(db).some((d) => d.id === id)),
      )
    )
      throw Error('请使用已有专业领域ID，主要领域须来自已选领域。');
    if (!Array.isArray(e.sources) || !e.sources.length || e.sources.length > 20)
      throw Error('每条专业知识须提供1～20个来源。');
    for (const s of e.sources) {
      if (
        Object.keys(s).some(
          (k) => !['kind', 'title', 'url', 'excerpt', 'date_note', 'original_date'].includes(k),
        )
      )
        throw Error('来源含未知字段。');
      validateSource(s);
    }
    e.content = cleanContent(e.content);
    if (!e.content.replace(/<[^>]*>/g, '').trim()) throw Error('专业正文不能为空。');
  }
  return p;
}
export function createProfessionalImport(getDb) {
  const pending = new Map();
  const stamp = (db) =>
    hash([
      professionalDomains(db),
      db.prepare('SELECT id,title,updated_at FROM entries ORDER BY id').all(),
    ]);
  return {
    preview(raw) {
      for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
      if (pending.size >= 8) throw Error('预览过多，请稍后重试。');
      const db = getDb(),
        value = parseProfessional(raw, db),
        token = randomUUID();
      pending.set(token, { value, raw, stamp: stamp(db), expires: Date.now() + 900000 });
      return {
        token,
        items: value.entries.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          sources: e.sources,
          duplicates: db
            .prepare(
              'SELECT e.id,e.title FROM entries e JOIN professional_entries p ON p.entry_id=e.id WHERE e.title=?',
            )
            .all(e.title),
        })),
        notice: '仅创建新知识；不会合并或覆盖同名记录。所有导入均保存为待审核。',
      };
    },
    commit(input) {
      const p = pending.get(input.token),
        db = getDb();
      if (!p || p.expires < Date.now() || p.stamp !== stamp(db))
        throw Error('专业导入预览已过期或资料已变化，请重新预览。');
      if (
        input.confirm !== '确认导入专业知识' ||
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        new Set(input.ids).size !== input.ids.length ||
        input.ids.some((id) => !p.value.entries.some((e) => e.id === id))
      )
        throw Error('请选择本次预览中的不同条目并确认。');
      const entries = p.value.entries.filter((e) => input.ids.includes(e.id));
      if (
        entries.some((e) =>
          db
            .prepare(
              'SELECT 1 FROM entries e JOIN professional_entries p ON p.entry_id=e.id WHERE e.title=?',
            )
            .get(e.title),
        ) &&
        input.duplicate !== '另存新知识'
      )
        throw Error('发现同名专业知识，需要明确另存新知识。');
      const result = transaction(db, () => {
        const batch = randomUUID();
        db.prepare('INSERT INTO knowledge_imports VALUES(?,?,?,?,?)').run(
          batch,
          hash(JSON.parse(p.raw)),
          p.raw,
          'json',
          new Date().toISOString(),
        );
        return entries.map(({ sources, ...e }) => {
          const card = saveProfessional(
            db,
            { ...e, status: 'review', newSource: sources[0] },
            undefined,
            { outer: true },
          );
          // Additional sources use the same validated source store, never a second content store.
          for (const s of sources.slice(1)) {
            const id = addSource(db, s);
            db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(card.id, id, '');
          }
          db.prepare('INSERT INTO knowledge_import_entries VALUES(?,?,?)').run(
            card.id,
            batch,
            e.id,
          );
          db.prepare(
            'UPDATE knowledge_sources SET batch_id=? WHERE id IN (SELECT source_id FROM knowledge_entry_sources WHERE entry_id=?)',
          ).run(batch, card.id);
          return { id: card.id, title: card.title };
        });
      });
      pending.delete(input.token);
      return { items: result };
    },
    cancel(token) {
      pending.delete(token);
      return { ok: true };
    },
  };
}
import { addSource } from './knowledge/store.js';
