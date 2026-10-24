import { resolve } from '../assistant/catalog.js';
import { relationTypes, writeRelation, changeRelations } from '../relations.js';
import { validateSchema } from './schema.js';
import { randomUUID } from 'node:crypto';
import { AiError } from './provider.js';
const obj = (properties) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }),
  str = (maxLength) => ({ type: 'string', maxLength }),
  arr = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export function prepareRelations(db, input) {
  if (
    !Array.isArray(input.ids) ||
    input.ids.length < 2 ||
    input.ids.length > 10 ||
    new Set(input.ids).size !== input.ids.length
  )
    throw new AiError('input');
  const sources = input.ids.map((id) => resolve(db, 'entries:' + id));
  const payload = { mode: 'relations', sources: sources.map(({ hash, ...s }) => s) };
  const chars = JSON.stringify(payload).length;
  if (chars > 12000) throw new AiError('input');
  const ref = { type: 'string', enum: input.ids };
  const schema = obj({
    status: { type: 'string', enum: ['ready', 'insufficient'] },
    suggestions: arr(
      obj({
        from_id: ref,
        to_id: ref,
        type: { type: 'string', enum: relationTypes },
        note: str(1000),
        evidence: arr(obj({ id: ref, quote: str(2000) }), 10, 1),
        uncertainty: str(1000),
      }),
      20,
    ),
    missing: arr(str(1000), 10),
  });
  return {
    payload,
    schema,
    snapshots: sources.map((s) => ({ id: s.id, hash: s.hash })),
    chars,
    estimatedTokens: Math.ceil(chars / 1.5),
    insufficient: sources.filter((s) => s.hasEvidence).length < 2,
  };
}
export const emptyRelations = () => ({
  status: 'insufficient',
  suggestions: [],
  missing: ['至少两条选中资料需要具体文字依据；仅网址标题不能视为已读正文。'],
});
export function normalizeRelations(value, p) {
  for (const s of value.suggestions) {
    if (s.from_id === s.to_id || !s.note.trim() || !s.uncertainty.trim())
      throw new AiError('invalid_output');
    for (const e of s.evidence) {
      const source = p.payload.sources.find((r) => r.id === e.id);
      if (
        ![s.from_id, s.to_id].includes(e.id) ||
        !source?.hasEvidence ||
        !e.quote.trim() ||
        !source.text.includes(e.quote)
      )
        throw new AiError('invalid_output');
    }
  }
  return value;
}
export function createRelationReview(getDb, ai, { beforeCommit } = {}) {
  const pending = new Map();
  const prune = () => {
    for (const [k, r] of pending) if (r.at < Date.now() - 900000) pending.delete(k);
  };
  const recheck = (p) => {
    for (const r of p.snapshots)
      if (resolve(getDb(), 'entries:' + r.id).hash !== r.hash)
        throw Error('资料或来源已变化，请重新分析，未写入。');
  };
  return {
    estimate(input) {
      const p = prepareRelations(getDb(), input),
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
      prune();
      if (pending.size >= 8) throw Error('待审核过多，请取消旧预览。');
      const p = prepareRelations(getDb(), input),
        r = await ai.suggest({ ...input, mode: 'relations' }, signal);
      recheck(p);
      if (r.suggestion.status === 'insufficient') return r;
      const token = randomUUID();
      pending.set(token, { p, at: Date.now() });
      return { ...r, token };
    },
    apply(input) {
      prune();
      const r = pending.get(input.token);
      if (!r || input.confirm !== '采用关联建议') throw Error('审核已失效或未确认。');
      recheck(r.p);
      validateSchema(input.plan, r.p.schema);
      normalizeRelations(input.plan, r.p);
      if (
        !Array.isArray(input.selected) ||
        !input.selected.length ||
        new Set(input.selected).size !== input.selected.length ||
        input.selected.some((n) => !Number.isInteger(n) || !input.plan.suggestions[n])
      )
        throw Error('选择不属于方案。');
      const result = changeRelations(
        getDb(),
        () => ({
          ids: input.selected.map(
            (n) =>
              writeRelation(getDb(), input.plan.suggestions[n], {
                origin: 'ai',
                state: 'candidate',
              }).id,
          ),
        }),
        { beforeCommit },
      );
      pending.delete(input.token);
      return { ...result, notice: '已保存AI候选，仍需逐条确认；没有修改正文或判定冲突孰真。' };
    },
    cancel(token) {
      pending.delete(token);
      return { ok: true };
    },
  };
}
