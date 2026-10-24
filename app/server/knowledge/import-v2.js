import { relationTypes, writeRelation } from '../relations.js';
import { randomUUID } from 'node:crypto';
import { parseExchange } from './exchange.js';
import { transaction, saveRecord, addSource } from './store.js';
import { saveEntry, kinds } from '../store.js';
import { attach } from './structure.js';
import { saveDomain, assignPrimary } from '../unified.js';
export function commitV2(db, prepared, input, { beforeCommit } = {}) {
  const p = prepared.value;
  if (
    input.confirm !== '确认导入所选知识' ||
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100 ||
    new Set(input.items.map((i) => i.id)).size !== input.items.length
  )
    throw Error('请选择1～100条不同内容并确认。');
  if (
    db.prepare('SELECT id FROM knowledge_imports WHERE hash=?').get(prepared.hash) &&
    input.repeat !== '另存所选知识'
  )
    throw Error('资料已导入，请明确另存或取消。');
  if (
    !Array.isArray(input.approvedTaxonomy) ||
    !Array.isArray(input.approvedDomains) ||
    input.approvedTaxonomy.length > 300 ||
    input.approvedDomains.length > 100
  )
    throw Error('领域及分类审核无效。');
  const original = new Map(p.items.map((i) => [i.id, i]));
  const fields = [
    'id',
    'title',
    'body',
    'body_format',
    'content_type',
    'url',
    'description',
    'tool_kind',
    'parent',
    'domains',
    'tags',
    'collections',
    'primary_domain_id',
  ];
  for (const r of input.items)
    if (!original.has(r.id) || Object.keys(r).some((k) => !fields.includes(k)))
      throw Error('审核条目不属于本次资料或含未知字段。');
  const packageReview = {
    ...p,
    items: input.items.map((r) => {
      const { content, ...o } = original.get(r.id);
      const { domains, tags, collections, primary_domain_id, ...changes } = r;
      return { ...o, ...changes };
    }),
    relations: (p.relations || []).filter(
      (r) => input.items.some((i) => i.id === r.from) && input.items.some((i) => i.id === r.to),
    ),
  };
  const checked = parseExchange(JSON.stringify(packageReview)).value;
  if (checked.items.some((i) => i.content_type === 'unspecified'))
    throw Error('请人工选择未明确的内容类型。');
  return transaction(db, () => {
    const batchId = randomUUID(),
      now = new Date().toISOString();
    db.prepare('INSERT INTO knowledge_imports VALUES(?,?,?,?,?)').run(
      batchId,
      prepared.hash,
      prepared.raw,
      'json',
      now,
    );
    const nodes = new Map((p.domains || []).map((d) => [d.id, d])),
      approved = new Set(input.approvedDomains),
      createdDomains = new Map();
    for (const id of approved)
      if (!nodes.has(id) || (nodes.get(id).parent && !approved.has(nodes.get(id).parent)))
        throw Error('创建子领域须同时确认父领域。');
    const createNode = (id) => {
      if (createdDomains.has(id)) return createdDomains.get(id);
      const node = nodes.get(id),
        parent = node.parent ? createNode(node.parent) : null;
      const old = db
        .prepare(
          'SELECT d.id,s.parent_id FROM domains d LEFT JOIN domain_structure s ON s.domain_id=d.id WHERE d.name=?',
        )
        .get(node.name);
      if (old && (old.parent_id || null) !== parent)
        throw Error('同名领域已有不同父级，请取消创建并人工选择已有领域。');
      const key = old?.id || saveDomain(db, { name: node.name, parent_id: parent }).id;
      createdDomains.set(id, key);
      return key;
    };
    for (const id of approved) createNode(id);
    const created = new Map();
    for (const choice of input.approvedTaxonomy) {
      if (
        !kinds.includes(choice.kind) ||
        !input.items.some((i) => (original.get(i.id)[choice.kind] || []).includes(choice.name))
      )
        throw Error('分类创建不属于选中资料建议。');
      let t = db.prepare(`SELECT id FROM ${choice.kind} WHERE name=?`).get(choice.name);
      if (!t) {
        t = { id: randomUUID() };
        db.prepare(`INSERT INTO ${choice.kind}(id,name) VALUES(?,?)`).run(t.id, choice.name);
      }
      created.set(choice.kind + '\n' + choice.name, t.id);
    }
    const ids = new Map(),
      sourceIds = new Map();
    for (const item of checked.items) {
      const review = input.items.find((r) => r.id === item.id),
        o = original.get(item.id),
        form = {
          title: item.title,
          description: item.description || '',
          url: item.url || '',
          content: item.content,
          type: item.content_type === 'bookmark' ? 'bookmark' : 'note',
          resource_kind: item.content_type === 'tool' ? 'tool' : 'knowledge',
          tool_kind: item.content_type === 'tool' ? item.tool_kind : '',
          pinned: 0,
          cover_asset_id: null,
          allowDuplicate: input.allowDuplicateUrls === true,
        };
      for (const k of kinds) {
        if (!Array.isArray(review[k]) || review[k].length > 100) throw Error('分类选择无效。');
        form[k] = [
          ...new Set([
            ...review[k],
            ...(o[k] || []).map((n) => created.get(k + '\n' + n)).filter(Boolean),
          ]),
        ];
      }
      const suggestedPrimary = createdDomains.get(o.primary_domain);
      if (suggestedPrimary) form.domains = [...new Set([...form.domains, suggestedPrimary])];
      form.primary_domain_id = review.primary_domain_id || suggestedPrimary || null;
      let saved;
      if (['document', 'block'].includes(item.content_type))
        saved = saveRecord(
          db,
          {
            ...form,
            kind: item.content_type === 'document' ? 'page' : 'point',
            status: item.status || 'review',
            epistemic: item.epistemic || 'ai_inference',
            priority: item.priority || 0,
            questions: (item.questions || []).join('\n'),
            original_date: item.original_date || null,
            provided_recorded_at: item.recorded_at || null,
            date_note: item.date_note || '',
            directory_id: null,
            references: [],
          },
          undefined,
          { outer: true },
        );
      else saved = saveEntry(db, form, undefined, { transaction: false });
      if (saved.duplicate) throw Error('网址已存在，请查看原记录或明确确认另存网址副本。');
      ids.set(item.id, saved.id);
      assignPrimary(db, saved.id, form.primary_domain_id);
      db.prepare('INSERT INTO content_provenance VALUES(?,?,?,?,?,?,?,?)').run(
        saved.id,
        batchId,
        item.id,
        item.original_date || null,
        item.recorded_at || null,
        item.epistemic || 'ai_inference',
        item.status || 'review',
        item.priority || 0,
      );
      if (['document', 'block'].includes(item.content_type))
        db.prepare('INSERT INTO knowledge_import_entries VALUES(?,?,?)').run(
          saved.id,
          batchId,
          item.id,
        );
      for (const ref of o.references || []) {
        if (!sourceIds.has(ref.source_id))
          sourceIds.set(
            ref.source_id,
            addSource(
              db,
              p.sources.find((s) => s.id === ref.source_id),
              batchId,
            ),
          );
        const sid = sourceIds.get(ref.source_id);
        db.prepare('INSERT INTO content_source_links VALUES(?,?,?)').run(saved.id, sid, ref.quote);
        if (['document', 'block'].includes(item.content_type))
          db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(
            saved.id,
            sid,
            ref.quote,
          );
      }
    }
    const structural = checked.items
      .filter((i) => i.parent)
      .map((i) => ({ id: ids.get(i.id), parent_id: ids.get(i.parent) }));
    if (structural.length) attach(db, { items: structural });
    if (input.includeRelations === true)
      for (const r of checked.relations || []) {
        if (relationTypes.includes(r.kind))
          writeRelation(
            db,
            {
              from_id: ids.get(r.from),
              to_id: ids.get(r.to),
              type: r.kind,
              note: r.note || '导入包关联建议，未验证',
              evidence: [],
              uncertainty: '来自外部导入包，需逐项核对',
            },
            { origin: 'import', state: 'candidate' },
          );
        else
          db.prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)').run(
            randomUUID(),
            ids.get(r.from),
            ids.get(r.to),
            r.kind,
            'candidate',
            r.note || '',
            now,
          );
      }
    beforeCommit?.(db);
    return { batchId, ids: Object.fromEntries(ids), count: ids.size };
  });
}
