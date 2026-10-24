export type Kind = 'domains' | 'tags' | 'collections';
export type Tax = { id: string; name: string; count?: number };
export const toolLabels = {
  website: '网站',
  online: '在线工具',
  ai: 'AI 服务',
  desktop: '桌面软件',
  custom: '自制工具',
  other: '其他资源',
};
export type ToolKind = keyof typeof toolLabels;
export type Entry = {
  mindmap?: boolean;
  id: string;
  type: 'bookmark' | 'note';
  lifecycle?: {
    state: string;
    previous_state: string | null;
    changed_at: string;
    deleted_at: string | null;
  } | null;
  knowledge_kind?: string;
  primary_domain_id?: string | null;
  resource_kind?: 'knowledge' | 'tool';
  tool_kind?: ToolKind | '';
  title: string;
  url: string | null;
  description: string;
  content: string;
  plain_text?: string;
  provenance?: any;
  cover_asset_id: string | null;
  cover: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  domains: Tax[];
  tags: Tax[];
  collections: Tax[];
};
export type Form = {
  primary_domain_id?: string | null;
  type: 'bookmark' | 'note';
  knowledge_kind?: string;
  resource_kind?: 'knowledge' | 'tool';
  tool_kind?: ToolKind | '';
  title: string;
  url: string;
  description: string;
  content: string;
  cover_asset_id: string | null;
  domains: string[];
  tags: string[];
  collections: string[];
  pinned: number;
};
export type Meta = {
  version: string;
  dataPath: string;
  stats: {
    total: number;
    pending: number;
    notes: number;
    tools: number;
    knowledge?: number;
    captures?: number;
  };
  domains: Tax[];
  tags: Tax[];
  collections: Tax[];
  recent: Record<Kind, Tax[]>;
};
export const labels = { domains: '领域', tags: '标签', collections: '专题收藏夹' };
export const blank = (): Form => ({
  type: 'bookmark',
  title: '',
  url: '',
  description: '',
  content: '',
  cover_asset_id: null,
  domains: [],
  tags: [],
  collections: [],
  pinned: 0,
});
export async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + url, {
    ...init,
    headers: {
      'X-PK-Request': '1',
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error || (data.duplicate ? '该网址已存在' : '请求失败')) as Error & {
      duplicate?: { id: string; title: string };
    };
    e.duplicate = data.duplicate;
    throw e;
  }
  return data;
}
