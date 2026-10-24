import { randomUUID } from 'node:crypto';
import { decodeHTML } from 'entities';
const escapeHTML = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
import { readWorkspace, writeWorkspace } from './workspace.js';
export function quickDraft(dir) {
  const d = readWorkspace(dir).drafts.quick;
  return d
    ? {
        text: decodeHTML(d.form.content.slice(3, -4)),
        title: d.form.title,
        domain: d.form.domains[0] || '',
        tag: d.form.tags[0] || '',
        revision: d.baseUpdatedAt,
        savedAt: d.savedAt,
      }
    : { text: '', title: '', domain: '', tag: '', revision: '', savedAt: '' };
}
export function saveQuickDraft(db, dir, input, clear = false) {
  const w = readWorkspace(dir),
    revision = w.drafts.quick?.baseUpdatedAt || '';
  if (typeof input.revision !== 'string' || input.revision !== revision)
    throw Error('快速草稿已在其他窗口变化，请重新载入或明确保留当前输入；未覆盖旧草稿。');
  if (clear) delete w.drafts.quick;
  else {
    if (
      typeof input.text !== 'string' ||
      input.text.length > 20000 ||
      typeof input.title !== 'string' ||
      input.title.length > 200
    )
      throw Error('快速草稿文字格式无效或超限。');
    for (const kind of ['domain', 'tag'])
      if (
        typeof input[kind] !== 'string' ||
        (input[kind] &&
          !db
            .prepare('SELECT id FROM ' + (kind === 'domain' ? 'domains' : 'tags') + ' WHERE id=?')
            .get(input[kind]))
      )
        throw Error('草稿分类已变化，请重新选择。');
    w.drafts.quick = {
      form: {
        type: 'note',
        title: input.title,
        url: '',
        description: '',
        content: '<p>' + escapeHTML(input.text) + '</p>',
        cover_asset_id: null,
        pinned: 0,
        domains: input.domain ? [input.domain] : [],
        tags: input.tag ? [input.tag] : [],
        collections: [],
      },
      baseUpdatedAt: randomUUID(),
      savedAt: new Date().toISOString(),
    };
  }
  writeWorkspace(dir, w);
  return quickDraft(dir);
}
