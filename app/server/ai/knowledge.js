import { createHash } from 'node:crypto';
import { AiError } from './provider.js';
import { getRecord } from '../knowledge/store.js';
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (maxLength) => ({ type: 'string', maxLength });
const arr = (items, maxItems = 10, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export const fingerprint = (r) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        r.id,
        r.title,
        r.description,
        r.content,
        r.revision,
        r.updated_at,
        r.directory_id,
        r.parent_id,
        r.original_date,
        r.epistemic,
        r.status,
        r.sources,
        r.collections,
        r.tags,
        r.domains,
        r.primary_domain_id,
        r.provenance,
      ]),
    )
    .digest('hex');
export const integrationEmpty = () => ({
  status: 'insufficient',
  reason: '信息不足：至少两条选中知识需要具体正文；标题和网址不能作为正文证据。',
  keepIds: [],
  order: [],
  sections: [],
  relations: [],
  verification: [],
});
export function prepareKnowledgeInput(db, input) {
  if (
    !Array.isArray(input.ids) ||
    input.ids.length < 2 ||
    input.ids.length > 10 ||
    new Set(input.ids).size !== input.ids.length
  )
    throw new AiError('input');
  const records = input.ids.map((id) => getRecord(db, id));
  const materials = records.map((r) => ({
    id: r.id,
    title: r.title,
    text: r.description + '\n' + r.plain_text,
    epistemic: r.epistemic,
    status: r.status,
    originalDate: r.original_date,
    dateNote: r.date_note,
    sourceDates: r.sources.map((s) => ({ id: s.id, date: s.original_date, note: s.date_note })),
    hasEvidence:
      (r.description + r.plain_text).replace(/https?:\/\/\S+/g, '').replace(/\s/g, '').length >= 24,
  }));
  const payload = { mode: 'integration', sources: materials };
  const chars = JSON.stringify(payload).length;
  if (chars > 12000) throw new AiError('input');
  const all = records.map((r) => r.id),
    allowed = materials.filter((r) => r.hasEvidence).map((r) => r.id);
  const id = { type: 'string', enum: all };
  const cite = arr({ type: 'string', enum: allowed.length ? allowed : ['NO_SOURCE'] }, 10, 1);
  const schema = obj({
    status: { type: 'string', enum: ['ready', 'insufficient'] },
    reason: str(600),
    keepIds: arr(id),
    order: arr(id),
    sections: arr(obj({ title: str(200), text: str(4000), sourceIds: cite }), 6),
    relations: arr(
      obj({
        kind: {
          type: 'string',
          enum: ['duplicate', 'complement', 'parent', 'conflict', 'revision', 'related'],
        },
        from: id,
        to: id,
        reason: str(400),
        fromQuote: str(250),
        toQuote: str(250),
      }),
      20,
    ),
    verification: arr(str(1000)),
  });
  const snapshots = records.map((r) => ({ id: r.id, title: r.title, hash: fingerprint(r) }));
  return {
    payload,
    schema,
    snapshots,
    chars,
    estimatedTokens: Math.ceil(chars / 1.5),
    insufficient: allowed.length < 2,
  };
}
export function normalizeIntegration(value, p) {
  if (value.status === 'insufficient')
    return { ...integrationEmpty(), reason: value.reason || integrationEmpty().reason };
  if (
    JSON.stringify(value).length > 50000 ||
    new Set(value.order).size !== value.order.length ||
    new Set(value.keepIds).size !== value.keepIds.length
  )
    throw new AiError('invalid_output');
  for (const s of value.sections)
    if (!s.title.trim() || !s.text.trim() || new Set(s.sourceIds).size !== s.sourceIds.length)
      throw new AiError('invalid_output');
  for (const r of value.relations) {
    const a = p.payload.sources.find((s) => s.id === r.from),
      b = p.payload.sources.find((s) => s.id === r.to);
    if (
      r.from === r.to ||
      !a?.hasEvidence ||
      !b?.hasEvidence ||
      !r.reason.trim() ||
      !r.fromQuote.trim() ||
      !r.toQuote.trim() ||
      !a.text.includes(r.fromQuote) ||
      !b.text.includes(r.toQuote)
    )
      throw new AiError('invalid_output');
  }
  return value;
}
