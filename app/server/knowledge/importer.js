import { randomUUID } from 'node:crypto';
import { parseExchange, textHtml } from './exchange.js';
import { directories, saveDirectory, saveRecord, addSource, transaction } from './store.js';
import { kinds, cleanContent } from '../store.js';
import { attach } from './structure.js';
import { commitV2 } from './import-v2.js';
const normalize = (s) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
export function prepareImport(db, raw, format, convertLegacy = false) {
  const prepared = parseExchange(raw, format),
    originalPackage = prepared.value;
  if(originalPackage.format==='professional-knowledge-v1')throw Error('请使用专业知识导入入口，未写入个人知识。');
  if (convertLegacy && originalPackage.version === 1) {
    const isChapter = (i) => {
      let p = i.parent;
      const seen = new Set([i.id]);
      while (p && !seen.has(p)) {
        seen.add(p);
        const parent = originalPackage.items.find((r) => r.id === p);
        if (!parent) return false;
        if (parent.kind === 'page') return true;
        p = parent.parent;
      }
      return false;
    };
    const converted = {
      format: originalPackage.format,
      version: 2,
      sources: originalPackage.sources,
      domains: originalPackage.directories || [],
      items: originalPackage.items.map((i) => {
        const { content, kind, directory, parent, ...rest } = i;
        const block = kind === 'point' && isChapter(i);
        return {
          ...rest,
          content_type: kind === 'page' ? 'document' : block ? 'block' : 'note',
          ...(block ? { parent } : {}),
          primary_domain: directory || null,
        };
      }),
      relations: [
        ...(originalPackage.relations || []),
        ...originalPackage.items
          .filter((i) => i.parent)
          .map((i) => ({
            from: i.parent,
            to: i.id,
            kind: 'parent',
            note: '旧包上下级建议，未经自动确认',
          })),
      ],
    };
    prepared.value = parseExchange(JSON.stringify(converted)).value;
  }
  const p = prepared.value;
  const taxonomy = Object.fromEntries(
    kinds.map((k) => [k, db.prepare(`SELECT id,name FROM ${k} ORDER BY name`).all()]),
  );
  const candidates = p.items.map((i) => {
    const keyword =
      '%' +
      i.title
        .trim()
        .slice(0, 30)
        .replace(/[\\%_]/g, '\\$&') +
      '%';
    const matches = db
      .prepare(
        "SELECT id,title,plain_text FROM entries e WHERE "+spaceSql(db)+" AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 5",
      )
      .all(keyword);
    return {
      id: i.id,
      matches: matches.map((e) => ({
        id: e.id,
        title: e.title,
        reason:
          normalize(e.title) === normalize(i.title)
            ? '同名标题，仅为候选，不能据此合并'
            : '标题关键词相近',
      })),
    };
  });
  const repeated = db
    .prepare('SELECT id,recorded_at FROM knowledge_imports WHERE hash=? ORDER BY recorded_at DESC')
    .all(prepared.hash);
  return {
    prepared,
    preview: {
      version: p.version,
      domainSuggestions: p.version === 2 ? p.domains || [] : [],
      items: p.items,
      sources: p.sources,
      directories: p.directories || [],
      relations: p.relations || [],
      taxonomy,
      existingDirectories: directories(db),
      candidates,
      repeated,
      hash: prepared.hash,
      notice:
        '所有建议尚未写入。日期仅来自用户资料；来源未抓取/验证。导入原始包将作为本地来源快照随知识备份保留。',
    },
  };
}
export function commitImport(db, prepared, input, { beforeCommit } = {}) {
  if (prepared.value.version === 2) return commitV2(db, prepared, input, { beforeCommit });
  const p = prepared.value;
  if (
    input.confirm !== '确认导入所选知识' ||
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100 ||
    new Set(input.items.map((i) => i.id)).size !== input.items.length
  )
    throw Error('请选择 1～100 条不同知识并明确确认。');
  if (
    db.prepare('SELECT id FROM knowledge_imports WHERE hash=?').get(prepared.hash) &&
    input.repeat !== '另存所选知识'
  )
    throw Error('同一份资料已导入，请明确另存所选知识或取消。');
  if (
    !Array.isArray(input.approvedTaxonomy) ||
    !Array.isArray(input.approvedDirectories) ||
    !Array.isArray(input.existingRelations) ||
    input.existingRelations.length > 100 ||
    input.approvedTaxonomy.length > 300 ||
    input.approvedDirectories.length > 100
  )
    throw Error('创建或关系审核选择无效。');
  const original = new Map(p.items.map((i) => [i.id, i]));
  const fields = [
    'id',
    'title',
    'body',
    'body_format',
    'kind',
    'status',
    'epistemic',
    'priority',
    'questions',
    'original_date',
    'provided_recorded_at',
    'date_note',
    'directory_id',
    'domains',
    'tags',
    'collections',
    'confirm',
    'parent',
  ];
  for (const i of input.items)
    if (
      Object.keys(i).some((k) => !fields.includes(k)) ||
      typeof i.body !== 'string' ||
      i.body.length > 100000 ||
      !['plain', 'html'].includes(i.body_format)
    )
      throw Error('审核条目字段、正文或格式无效。');
  if (input.items.some((i) => !original.has(i.id))) throw Error('知识不属于本次预览。');
  const selected = new Set(input.items.map((i) => i.id)),
    suggestedDirs = new Map((p.directories || []).map((d) => [d.id, d]));
  for (const id of input.approvedDirectories)
    if (!suggestedDirs.has(id)) throw Error('目录不属于本次建议。');
  const approved = new Set(input.approvedDirectories);
  for (const id of approved)
    if (suggestedDirs.get(id).parent && !approved.has(suggestedDirs.get(id).parent))
      throw Error('创建子目录前请同时确认建议父目录，或为条目选择已有目录。');
  const candidates = prepareImport(db, prepared.raw, prepared.format).preview.candidates;
  for (const r of input.existingRelations)
    if (
      !selected.has(r.from) ||
      !candidates.find((c) => c.id === r.from)?.matches.some((m) => m.id === r.to)
    )
      throw Error('候选关系不属于本次审核。');
  return transaction(db, () => {
    const batchId = randomUUID(),
      now = new Date().toISOString();
    db.prepare('INSERT INTO knowledge_imports VALUES(?,?,?,?,?)').run(
      batchId,
      prepared.hash,
      prepared.raw,
      prepared.format,
      now,
    );
    const createdTax = new Map();
    for (const choice of input.approvedTaxonomy) {
      if (
        !kinds.includes(choice.kind) ||
        typeof choice.name !== 'string' ||
        !input.items.some((i) => (original.get(i.id)[choice.kind] || []).includes(choice.name))
      )
        throw Error('分类创建不属于选中资料的建议。');
      let tax = db.prepare(`SELECT id FROM ${choice.kind} WHERE name=?`).get(choice.name);
      if (!tax) {
        tax = { id: randomUUID() };
        db.prepare(`INSERT INTO ${choice.kind} VALUES(?,?)`).run(tax.id, choice.name);
      }
      createdTax.set(choice.kind + '\n' + choice.name, tax.id);
    }
    const createdDirs = new Map();
    const createDir = (id) => {
      if (createdDirs.has(id)) return createdDirs.get(id);
      const d = suggestedDirs.get(id),
        parent = d.parent ? createDir(d.parent) : null;
      const existing = db
        .prepare('SELECT id FROM knowledge_directories WHERE name=? AND parent_id IS ?')
        .get(d.name, parent);
      const saved = existing || saveDirectory(db, { name: d.name, parent_id: parent });
      createdDirs.set(id, saved.id);
      return saved.id;
    };
    for (const id of approved) createDir(id);
    const ids = new Map(),
      sourceIds = new Map();
    for (const review of input.items) {
      if (
        review.body_format === 'html' &&
        (/\b(on\w+\s*=|javascript:|data:|data-entry-id)/i.test(review.body) ||
          /<\/?(script|iframe|object|style|img)\b/i.test(review.body))
      )
        throw Error('审核 HTML 含不安全内容，请使用纯文本。');
      const o = original.get(review.id),
        content = review.body_format === 'html' ? cleanContent(review.body) : textHtml(review.body);
      if (typeof review.body !== 'string' || review.body.length > 100000)
        throw Error('审核正文过长或无效。');
      const form = {
        ...review,
        content,
        type: 'note',
        resource_kind: 'knowledge',
        tool_kind: '',
        url: '',
        description: '',
        cover_asset_id: null,
        pinned: 0,
        references: [],
        kind: review.kind || o.kind || 'point',
        status: review.status || o.status || 'review',
        epistemic: review.epistemic || o.epistemic || 'ai_inference',
        priority: review.priority ?? o.priority ?? 0,
        questions: review.questions ?? (o.questions || []).join('\n'),
        original_date: Object.hasOwn(review, 'original_date')
          ? review.original_date
          : (o.original_date ?? null),
        provided_recorded_at: Object.hasOwn(review, 'provided_recorded_at')
          ? review.provided_recorded_at
          : (o.recorded_at ?? null),
        date_note: review.date_note ?? o.date_note ?? '',
        directory_id:
          review.directory_id === '__none__'
            ? null
            : review.directory_id || createdDirs.get(o.directory) || null,
      };
      for (const k of kinds) {
        if (!Array.isArray(review[k]) || review[k].length > 100) throw Error('审核分类无效。');
        form[k] = [
          ...new Set([
            ...review[k],
            ...(o[k] || []).map((name) => createdTax.get(k + '\n' + name)).filter(Boolean),
          ]),
        ];
      }
      const saved = saveRecord(db, form, undefined, { outer: true });
      ids.set(o.id, saved.id);
      db.prepare('INSERT INTO knowledge_import_entries VALUES(?,?,?)').run(saved.id, batchId, o.id);
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
        db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(
          saved.id,
          sourceIds.get(ref.source_id),
          ref.quote,
        );
      }
    }
    const insert = (from, to, kind, note) =>
      db
        .prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), from, to, kind, 'candidate', note || '', now);
    if (input.organize === true) {
      const structural = input.items
        .filter((i) => i.parent)
        .map((i) => {
          if (!ids.has(i.parent)) throw Error('章节父级未选中，请修改归属或选择父级。');
          return { id: ids.get(i.id), parent_id: ids.get(i.parent) };
        });
      if (structural.length) attach(db, { items: structural });
    }
    if (input.includeRelations === true) {
      const relations = [
        ...(p.relations || []),
        ...p.items
          .filter((i) => i.parent)
          .map((i) => ({ from: i.parent, to: i.id, kind: 'parent', note: '来源包中的上下级建议' })),
      ];
      for (const r of relations)
        if (selected.has(r.from) && selected.has(r.to))
          insert(ids.get(r.from), ids.get(r.to), r.kind, r.note);
    }
    for (const r of input.existingRelations)
      insert(ids.get(r.from), r.to, 'duplicate', '人工选择记录疑似重复候选，尚未确认或合并。');
    beforeCommit?.(db);
    return { batchId, ids: Object.fromEntries(ids), count: ids.size };
  });
}
export function createImportSession(getDb, { beforeCommit } = {}) {
  const previews = new Map();
  return {
    preview(raw, format, convertLegacy = false) {
      const now = Date.now();
      for (const [token, p] of previews) if (p.expires < now) previews.delete(token);
      if (previews.size >= 8) throw Error('预览过多，请完成或取消现有导入。');
      const result = prepareImport(getDb(), raw, format, convertLegacy),
        token = randomUUID();
      previews.set(token, { ...result, expires: now + 15 * 60 * 1000 });
      return { ...result.preview, token };
    },
    commit(input) {
      const p = previews.get(input.token);
      if (!p || p.expires < Date.now()) throw Error('预览已失效，请重新解析并审核。');
      const r = commitImport(getDb(), p.prepared, input, { beforeCommit });
      previews.delete(input.token);
      return r;
    },
    cancel(token) {
      previews.delete(token);
      return { ok: true };
    },
  };
}
import { spaceSql } from '../space.js';
