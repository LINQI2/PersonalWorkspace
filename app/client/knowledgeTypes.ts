import { api, blank, type Entry, type Form } from './shared';
export const knowledgeLabels = { capture: '原始收集', page: '综合文档', point: '知识块 / 独立内容' };
export const stateLabels = {
  inbox: '收集箱',
  draft: '草稿',
  review: '待验证',
  confirmed: '人工确认',
  archived: '归档',
};
export const epistemicLabels = {
  reported_fact: '来源报告的事实',
  ai_inference: 'AI 推断',
  user_judgment: '源资料中的用户判断',
};
export const sourceLabels = {
  chatgpt: 'ChatGPT',
  report: '周报/行业信息',
  inspiration: '个人灵感',
  website: '网站',
  other: '其他来源',
};
export const relationLabels = {
  duplicate: '疑似重复',
  complement: '互补',
  conflict: '冲突',
  revision: '修正',
  parent: '上下级',
};
export type Directory = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  count: number;
};
export type Source = {
  id?: string;
  kind: keyof typeof sourceLabels;
  title: string;
  url: string | null;
  original_date: string | null;
  date_note: string;
  excerpt: string;
  recorded_at?: string;
  provided_recorded_at?: string | null;
  batch_id?: string;
  quote?: string;
};
export type KnowledgeForm = Form & {
  parent_id?: string | null;
  page_id?: string | null;
  page_title?: string | null;
  kind: keyof typeof knowledgeLabels;
  directory_id: string | null;
  priority: number;
  status: keyof typeof stateLabels;
  epistemic: keyof typeof epistemicLabels;
  questions: string;
  original_date: string | null;
  provided_recorded_at?: string | null;
  date_note: string;
  references: string[];
  revision?: number;
  updated_at?: string;
  confirm?: string;
  newSource?: Source;
};
export type KnowledgeRecord = Entry &
  Omit<KnowledgeForm, 'domains' | 'tags' | 'collections' | 'references' | 'url'> & {
    import_batch?: { batch_id: string; local_id: string } | null;
    sources: Source[];
    references: Omit<Entry, 'content'>[];
    confirmed_at: string | null;
    relations: {
      id: string;
      from_id: string;
      to_id: string;
      from_title: string;
      to_title: string;
      kind: keyof typeof relationLabels;
      state: string;
      note: string;
    }[];
  };
export const knowledgeBlank = (
  kind: keyof typeof knowledgeLabels = 'capture',
  directory: string | null = null,
): KnowledgeForm => ({
  ...blank(),
  type: 'note',
  kind,
  directory_id: directory,
  priority: 0,
  status: kind === 'capture' ? 'inbox' : 'draft',
  epistemic: 'user_judgment',
  questions: '',
  original_date: null,
  date_note: '',
  references: [],
});
export async function knowledgeWrite<T = any>(url: string, method: string, body: any): Promise<T> {
  const session = await api<{ token: string }>('/local/session');
  return api<T>('/knowledge' + url, {
    method,
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify(body),
  });
}
export function directoryLabel(d: Directory, rows: Directory[]): string {
  const labels = [d.name];
  let p = d.parent_id;
  while (p) {
    const parent = rows.find((r) => r.id === p);
    if (!parent) break;
    labels.unshift(parent.name);
    p = parent.parent_id;
  }
  return labels.join(' / ');
}

export type KnowledgeSummary = Omit<
  KnowledgeRecord,
  'content' | 'sources' | 'references' | 'relations'
> & { source_count: number; reference_count: number };
