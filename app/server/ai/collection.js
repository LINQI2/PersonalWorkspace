import sanitize from 'sanitize-html';
import { decodeHTML } from 'entities';
import { sourceSnapshot, getCollection } from '../topics.js';
import { unifiedVersion, ruleMembers } from '../unified.js';
import { AiError } from './provider.js';
export const collectionEmpty = () => ({
  status: 'insufficient',
  title: '',
  reason: '信息不足：请在至少两条选中收藏中补充具体简介或正文；不会把只有标题的视频当成已读内容。',
  sections: [],
  core: [],
  related: [],
  differences: [],
  uncertainties: [],
  verification: [],
});
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (maxLength) => ({ type: 'string', maxLength });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export function collectionSchema(ids) {
  const cite = array({ type: 'string', enum: ids.length ? ids : ['NO_SOURCE'] }, 10);
  const claim = object({ text: text(1000), sourceIds: { ...cite, minItems: 1 } });
  const question = object({ text: text(1000), sourceIds: cite });
  return object({
    status: { type: 'string', enum: ['ready', 'insufficient'] },
    title: text(200),
    reason: text(600),
    sections: array(object({ heading: text(100), paragraphs: array(claim, 6) }), 6),
    core: array(claim, 8),
    related: array(claim, 8),
    differences: array(claim, 8),
    uncertainties: array(question, 8),
    verification: array(question, 8),
  });
}
const plain = (html) =>
  decodeHTML(
    sanitize(html.replace(/<\/(p|h2|h3|li|blockquote)>/g, '$&\n'), {
      allowedTags: [],
      allowedAttributes: {},
    }),
  ).trim();
export function prepareCollectionInput(db, input) {
  const topic = getCollection(db, input.collectionId);
  if (
    !Array.isArray(input.ids) ||
    input.ids.length < 3 ||
    input.ids.length > 10 ||
    new Set(input.ids).size !== input.ids.length ||
    input.ids.some((id) => typeof id !== 'string')
  )
    throw new AiError('input');
  const sources = [],
    materials = [];
  const dynamic = new Set(unifiedVersion(db) ? ruleMembers(db, topic.id) : []);
  for (const id of input.ids) {
    const manual = db
      .prepare(
        'SELECT e.* FROM entries e JOIN entry_collections r ON r.entry_id=e.id WHERE r.taxonomy_id=? AND e.id=?',
      )
      .get(topic.id, id);
    const e =
      manual || (dynamic.has(id) ? db.prepare('SELECT * FROM entries WHERE id=?').get(id) : null);
    if (!e) throw new AiError('input');
    const note = plain(e.content),
      description = e.description;
    const evidence =
      (description + note).replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\s/g, '').length >= 24;
    sources.push(sourceSnapshot(e, evidence));
    materials.push({
      id: e.id,
      title: e.title,
      description,
      note,
      type: e.type,
      sourceHost: e.url ? new URL(e.url).hostname : '原创笔记',
      hasEvidence: evidence,
    });
  }
  const payload = { mode: 'collection', sources: materials };
  if (JSON.stringify(payload).length > 12000) throw new AiError('input');
  const ids = sources.filter((s) => s.evidence).map((s) => s.id);
  return {
    payload,
    sources,
    revision: topic.revision,
    schema: collectionSchema(ids),
    insufficient: ids.length < 2,
  };
}
export function normalizeCollection(value, prepared) {
  if (JSON.stringify(value).length > 50000) throw new AiError('invalid_output');
  if (value.status === 'insufficient')
    return { ...collectionEmpty(), reason: value.reason || collectionEmpty().reason };
  if (
    !value.title.trim() ||
    !value.sections.length ||
    !value.core.length ||
    value.sections.some((s) => !s.paragraphs.length)
  )
    throw new AiError('invalid_output');
  const claims = [
    ...value.sections.flatMap((s) => s.paragraphs),
    ...value.core,
    ...value.related,
    ...value.differences,
    ...value.uncertainties,
    ...value.verification,
  ];
  for (const c of claims)
    if (
      !c.text.trim() ||
      c.sourceIds.some((id) => !prepared.sources.some((s) => s.id === id && s.evidence))
    )
      throw new AiError('invalid_output');
  return value;
}
