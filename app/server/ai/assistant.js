import { unifiedVersion } from '../unified.js';
import { resolve, inspect } from '../assistant/catalog.js';
import { AiError } from './provider.js';
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (maxLength) => ({ type: 'string', maxLength });
const arr = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export const qaEmpty = () => ({
  status: 'insufficient',
  answer: [],
  missing: ['未选择有依据的相关资料，不能生成有来源的回答。'],
});
export const structureEmpty = () => ({
  status: 'insufficient',
  suggestions: [],
  missing: ['请选择需要审查的具体对象。'],
});
export function prepareAssistant(db, input) {
  if (!['assistant_qa', 'assistant_structure'].includes(input?.mode)) throw new AiError('input');
  const structure = input.mode === 'assistant_structure';
  if (
    !Array.isArray(input.keys) ||
    input.keys.length > (structure ? 30 : 10) ||
    new Set(input.keys).size !== input.keys.length
  )
    throw new AiError('input');
  if (structure && unifiedVersion(db) && input.keys.some((k) => k.startsWith('directories:')))
    throw new AiError('input');
  const sources = input.keys.map((k) => resolve(db, k));
  if (
    !structure &&
    (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1000)
  )
    throw new AiError('input');
  const payload = {
    mode: input.mode,
    ...(!structure ? { question: input.question } : {}),
    sources: sources.map(({ hash, pageId, ...s }) => s),
  };
  if (structure)
    payload.localFindings = inspect(db).candidates.filter(
      (c) => input.keys.includes(c.key) && (!c.target || input.keys.includes(c.target)),
    );
  const chars = JSON.stringify(payload).length;
  if (chars > 12000) throw new AiError('input');
  const keys = sources.map((s) => s.key),
    evidence = sources.filter((s) => s.hasEvidence).map((s) => s.key),
    ref = { type: 'string', enum: evidence.length ? evidence : ['NO_SOURCE'] };
  const schema = structure
    ? obj({
        status: { type: 'string', enum: ['ready', 'insufficient'] },
        suggestions: arr(
          obj({
            object: { type: 'string', enum: [...keys, ''] },
            target: { type: 'string', enum: [...keys, ''] },
            kind: {
              type: 'string',
              enum: unifiedVersion(db)
                ? ['domains', 'tags', 'collections', 'entries']
                : ['domains', 'tags', 'collections', 'directories', 'entries'],
            },
            action: {
              type: 'string',
              enum: ['rename', 'merge', 'move', 'associate', 'create', 'keep'],
            },
            name: text(50),
            reason: text(600),
            evidenceIds: arr({ type: 'string', enum: keys.length ? keys : ['NO_SOURCE'] }, 30, 1),
          }),
          20,
        ),
        missing: arr(text(1000), 10),
      })
    : obj({
        status: { type: 'string', enum: ['ready', 'insufficient'] },
        answer: arr(
          obj({
            text: text(2000),
            basis: { type: 'string', enum: ['evidence', 'inference'] },
            sourceIds: arr(ref, 10, 1),
          }),
          8,
        ),
        missing: arr(text(1000), 10),
      });
  return {
    payload,
    schema,
    snapshots: sources.map((s) => ({ key: s.key, hash: s.hash })),
    chars,
    estimatedTokens: Math.ceil(chars / 1.5),
    insufficient: structure ? !sources.length : !evidence.length,
  };
}
export function normalizeAssistant(value, p) {
  if (value.status === 'insufficient')
    return p.payload.mode === 'assistant_structure'
      ? { ...structureEmpty(), missing: value.missing }
      : { ...qaEmpty(), missing: value.missing };
  if (p.payload.mode === 'assistant_structure') {
    for (const s of value.suggestions) {
      if (
        !s.reason.trim() ||
        !s.evidenceIds.length ||
        s.evidenceIds.some((k) => !p.snapshots.some((r) => r.key === k)) ||
        (s.object && !p.snapshots.some((r) => r.key === s.object)) ||
        (s.target && !p.snapshots.some((r) => r.key === s.target))
      )
        throw new AiError('invalid_output');
    }
  } else if (
    !value.answer.length ||
    value.answer.some(
      (c) =>
        !c.text.trim() ||
        c.sourceIds.some((k) => !p.payload.sources.some((s) => s.key === k && s.hasEvidence)),
    )
  )
    throw new AiError('invalid_output');
  return value;
}
