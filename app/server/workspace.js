import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { decodeHTML } from 'entities';
import { cleanContent, kinds, toolKinds } from './store.js';
export const workspaceName = 'workspace.json';
export const defaultWorkspace = () => ({
  version: 1,
  preferences: { layout: 'grid', sort: 'recent' },
  drafts: {},
});
export function validateWorkspace(input) {
  if (
    !input ||
    input.version !== 1 ||
    !['grid', 'list'].includes(input.preferences?.layout) ||
    !['recent', 'oldest', 'updated', 'pinned', 'title'].includes(input.preferences?.sort) ||
    !input.drafts ||
    Array.isArray(input.drafts) ||
    typeof input.drafts !== 'object' ||
    Object.keys(input.drafts).length > 50
  )
    throw new Error('本地浏览偏好或草稿格式无效。');
  const drafts = {};
  for (const [key, d] of Object.entries(input.drafts)) {
    if (
      !/^(new|new-tool|quick|[a-f0-9-]{36})$/.test(key) ||
      !d?.form ||
      !['bookmark', 'note'].includes(d.form.type)
    )
      throw new Error('草稿格式无效。');
    const f = d.form;
    if (
      key === 'quick' &&
      (f.type !== 'note' ||
        f.resource_kind !== undefined ||
        f.url !== '' ||
        f.description !== '' ||
        f.cover_asset_id !== null ||
        !/^<p>[^<>]*<\/p>$/.test(f.content) ||
        f.domains?.length > 1 ||
        f.tags?.length > 1 ||
        f.collections?.length ||
        f.content.length > 150000 ||
        decodeHTML(f.content.slice(3, -4)).length > 20000 ||
        !/^[a-f0-9-]{36}$/.test(d.baseUpdatedAt))
    )
      throw Error('快速草稿格式无效。');
    if (
      (f.resource_kind !== undefined && !['knowledge', 'tool'].includes(f.resource_kind)) ||
      (f.resource_kind === 'tool'
        ? !toolKinds.includes(f.tool_kind)
        : f.tool_kind !== undefined && f.tool_kind !== '')
    )
      throw Error('工具草稿类型无效。');
    for (const [field, max] of [
      ['title', 200],
      ['url', 4096],
      ['description', 2000],
      ['content', 1_000_000],
    ])
      if (typeof f[field] !== 'string' || f[field].length > max)
        throw new Error('草稿内容过长或格式无效。');
    for (const k of kinds)
      if (
        !Array.isArray(f[k]) ||
        f[k].length > 100 ||
        f[k].some((id) => typeof id !== 'string' || id.length > 100)
      )
        throw new Error('草稿分类无效。');
    if (f.cover_asset_id !== null && !/^[a-f0-9-]{36}$/.test(f.cover_asset_id))
      throw new Error('草稿封面无效。');
    drafts[key] = {
      form: {
        type: f.type,
        ...(f.resource_kind !== undefined
          ? { resource_kind: f.resource_kind, tool_kind: f.tool_kind || '' }
          : {}),
        title: f.title,
        url: f.url,
        description: f.description,
        content: cleanContent(f.content),
        cover_asset_id: f.cover_asset_id,
        pinned: f.pinned ? 1 : 0,
        ...Object.fromEntries(kinds.map((k) => [k, [...new Set(f[k])]])),
      },
      savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
      baseUpdatedAt: typeof d.baseUpdatedAt === 'string' ? d.baseUpdatedAt : '',
    };
  }
  const result = {
    version: 1,
    preferences: { layout: input.preferences.layout, sort: input.preferences.sort },
    drafts,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 10 * 1024 * 1024)
    throw new Error('本地草稿总量超过 10 MB，请保存或放弃部分草稿。');
  return result;
}
export function readWorkspace(dir) {
  const file = path.join(dir, workspaceName);
  if (!existsSync(file)) return defaultWorkspace();
  try {
    return validateWorkspace(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    throw new Error('无法读取本地草稿/偏好，请保留 workspace.json 并检查：' + e.message);
  }
}
export function writeWorkspace(dir, value) {
  const normalized = validateWorkspace(value),
    file = path.join(dir, workspaceName),
    tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(normalized));
  renameSync(tmp, file);
  return normalized;
}
