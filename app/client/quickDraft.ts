import { useSyncExternalStore } from 'react';
import { api } from './shared';
type Values = { text: string; title: string; domain: string; tag: string };
type Draft = Values & { revision: string; savedAt: string };
type State = Draft & { loaded: boolean; status: string; error: string; conflict: boolean };
let state: State = {
  text: '',
  title: '',
  domain: '',
  tag: '',
  revision: '',
  savedAt: '',
  loaded: false,
  status: '载入草稿…',
  error: '',
  conflict: false,
};
const listeners = new Set<() => void>();
let owner = '',
  timer: ReturnType<typeof setTimeout>,
  saving: Promise<void> | undefined,
  epoch = 0;
const fields = (v: Values): Values => ({
  text: v.text,
  title: v.title,
  domain: v.domain,
  tag: v.tag,
});
const emit = (p: Partial<State>) => {
  state = { ...state, ...p };
  listeners.forEach((f) => f());
};
const previousTab = sessionStorage.getItem('pk-quick-tab'),
  tabId = crypto.randomUUID();
sessionStorage.setItem('pk-quick-tab', tabId);
const journalPrefix = () => 'pk-quick-recovery:' + owner + ':';
const journalKey = () => journalPrefix() + tabId;
let recoverySource = '';
const journal = () => {
  try {
    localStorage.setItem(
      journalKey(),
      JSON.stringify({ ...fields(state), revision: state.revision, at: Date.now() }),
    );
  } catch {
    emit({ error: '浏览器恢复副本无法保存，请保持窗口打开并及时保存记录。' });
  }
};
async function write(method: string, body: object) {
  const s = await api('/local/session');
  return api<Draft>('/quick-draft', {
    method,
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify(body),
  });
}
async function load() {
  try {
    const remote = await api<Draft>('/quick-draft');
    recoverySource = previousTab ? journalPrefix() + previousTab : journalKey();
    let raw = localStorage.getItem(recoverySource),
      foreign = false;
    if (!raw) {
      const key = Object.keys(localStorage)
        .filter((k) => k.startsWith(journalPrefix()))
        .at(-1);
      if (key) {
        raw = localStorage.getItem(key);
        recoverySource = key;
        foreign = true;
      }
    }
    let pending: Draft | undefined;
    if (raw) {
      try {
        const x = JSON.parse(raw);
        if (
          typeof x.text === 'string' &&
          x.text.length <= 20000 &&
          typeof x.title === 'string' &&
          x.title.length <= 200 &&
          typeof x.domain === 'string' &&
          typeof x.tag === 'string' &&
          typeof x.revision === 'string'
        )
          pending = x;
      } catch {}
    }
    if (pending && JSON.stringify(fields(pending)) !== JSON.stringify(fields(remote))) {
      emit({
        ...pending,
        loaded: true,
        conflict: foreign || pending.revision !== remote.revision,
        status: '已恢复本机临时输入',
        error:
          foreign || pending.revision !== remote.revision
            ? '检测到另一窗口或未同步草稿；请查看后明确选择保留哪份。'
            : '',
      });
      if (!foreign && pending.revision === remote.revision) schedule();
    } else {
      emit({
        ...remote,
        loaded: true,
        status: remote.text ? '已恢复本地草稿' : '尚未输入',
        error: '',
        conflict: false,
      });
      localStorage.removeItem(journalKey());
    }
  } catch (e) {
    emit({ loaded: true, error: (e as Error).message, status: '草稿读取失败', conflict: true });
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 400);
}
export function initQuickDraft(dataPath: string) {
  if (owner === dataPath) return;
  owner = dataPath;
  void load();
}
export function updateQuickDraft(p: Partial<Values>) {
  epoch++;
  emit({ ...p, status: '输入尚未保存为正式内容' });
  journal();
  if (!state.conflict) schedule();
}
async function flush() {
  clearTimeout(timer);
  if (saving) {
    await saving;
    return flush();
  }
  if (!state.loaded || state.conflict) return;
  const version = epoch,
    request = { ...fields(state), revision: state.revision };
  emit({ status: '正在保护临时草稿…' });
  saving = (async () => {
    try {
      const d = await write('PUT', request);
      emit({
        revision: d.revision,
        savedAt: d.savedAt,
        status: version === epoch ? '临时草稿已保护' : '输入尚未同步',
        error: '',
      });
      journal();
    } catch (e) {
      emit({ error: (e as Error).message, status: '草稿同步失败；当前输入保留', conflict: true });
    }
  })();
  await saving;
  saving = undefined;
  if (version !== epoch && !state.conflict) await flush();
}
export async function settleQuickDraft(choice: 'remote' | 'local') {
  clearTimeout(timer);
  await saving;
  try {
    const remote = await api<Draft>('/quick-draft');
    if (choice === 'remote') {
      emit({ ...remote, loaded: true, conflict: false, error: '', status: '已载入服务端草稿' });
      localStorage.removeItem(journalKey());
      if (recoverySource) localStorage.removeItem(recoverySource);
    } else {
      emit({ revision: remote.revision, conflict: false, error: '' });
      journal();
      await flush();
    }
  } catch (e) {
    emit({ error: (e as Error).message, conflict: true });
  }
}
const clearMatching = (input: Values) => {
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(journalPrefix()))) {
    try {
      if (
        JSON.stringify(fields(JSON.parse(localStorage.getItem(key) || '{}'))) ===
        JSON.stringify(fields(input))
      )
        localStorage.removeItem(key);
    } catch {}
  }
};
export async function captureQuickDraft() {
  await flush();
  if (state.conflict) throw Error('请先处理草稿冲突，再保存记录。');
  const input = { ...fields(state) },
    revision = state.revision;
  const s = await api('/local/session');
  await api('/capture', {
    method: 'POST',
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify({
      text: input.text,
      title: input.title,
      domains: input.domain ? [input.domain] : [],
      tags: input.tag ? [input.tag] : [],
    }),
  });
  // The record is already committed. A failed draft clear must never encourage duplicate submission.
  try {
    await write('DELETE', { revision });
    emit({
      text: '',
      title: '',
      domain: '',
      tag: '',
      revision: '',
      savedAt: '',
      status: '已保存到收集箱',
      error: '',
    });
    clearMatching(input);
  } catch (e) {
    emit({
      text: '',
      title: '',
      status: '正式记录已保存；旧临时草稿未清除',
      error: (e as Error).message,
      conflict: true,
    });
    localStorage.removeItem(journalKey());
  }
}
export async function discardQuickDraft() {
  await flush();
  if (state.conflict) throw Error('请先在快速记录中核对草稿冲突。');
  await write('DELETE', { revision: state.revision });
  emit({
    text: '',
    title: '',
    domain: '',
    tag: '',
    revision: '',
    savedAt: '',
    status: '临时草稿已丢弃',
    error: '',
  });
  localStorage.removeItem(journalKey());
}
window.addEventListener('storage', (e) => {
  if (e.key?.startsWith(journalPrefix()) && e.newValue)
    emit({ conflict: true, error: '另一窗口的临时输入已变化。当前输入保留，请明确选择草稿。' });
});
export function useQuickDraft() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
}
