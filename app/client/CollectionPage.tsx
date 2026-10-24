import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Sparkles,
  ArrowUpRight,
  Pencil,
  BookOpen,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api, type Entry } from './shared';
import { Cover, Dialog, source } from './components';
import { RichEditor } from './RichEditor';

type Source = {
  id: string;
  title: string;
  url: string | null;
  type: string;
  evidence: boolean;
  hash: string;
  updated_at: string;
};
type Topic = {
  id: string;
  name: string;
  introduction: string;
  content: string;
  revision: number;
  updated_at: string;
  count: number;
  sources: Source[];
};
type TopicForm = Pick<Topic, 'name' | 'introduction' | 'content' | 'revision'> & {
  aiDraftId?: string;
  adoptMode?: 'append' | 'replace';
};
type Claim = { text: string; sourceIds: string[] };
type Suggestion = {
  status: string;
  title: string;
  reason: string;
  sections: { heading: string; paragraphs: Claim[] }[];
  core: Claim[];
  related: Claim[];
  differences: Claim[];
  uncertainties: Claim[];
  verification: Claim[];
};
type AiDraft = {
  id: string;
  suggestion: Suggestion;
  sources: Source[];
  baseRevision: number;
  reviewTitle?: string;
  review?: string;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const topicForm = (t: Topic): TopicForm => ({
  name: t.name,
  introduction: t.introduction,
  content: t.content,
  revision: t.revision,
});
function previewText(d: AiDraft) {
  const line = (c: Claim) =>
    c.text +
    c.sourceIds
      .map((id) => ' 〔来源' + (d.sources.findIndex((s) => s.id === id) + 1) + '〕')
      .join('');
  return [
    ...d.suggestion.sections.flatMap((s) => ['## ' + s.heading, ...s.paragraphs.map(line)]),
    ...(['core', 'related', 'differences', 'uncertainties', 'verification'] as const).flatMap(
      (key, index) =>
        d.suggestion[key].length
          ? [
              '## ' +
                ['核心观点', '相同或相关观点', '不同观点', '不确定之处', '需要继续验证'][index],
              ...d.suggestion[key].map(line),
            ]
          : [],
    ),
  ].join('\n\n');
}
function reviewHtml(title: string, text: string, sources: Source[]) {
  const inline = (line: string) =>
    escape(line).replace(/〔来源(\d+)〕/g, (token, n) => {
      const s = sources[Number(n) - 1];
      return s
        ? '<a href="#" data-entry-id="' + escape(s.id) + '">〔' + escape(s.title) + '〕</a>'
        : token;
    });
  return (
    '<h2>' +
    escape(title) +
    '</h2>' +
    text
      .split(/\n+/)
      .filter((s) => s.trim())
      .map((s) =>
        s.startsWith('## ') ? '<h3>' + inline(s.slice(3)) + '</h3>' : '<p>' + inline(s) + '</p>',
      )
      .join('')
  );
}
export function CollectionPage({
  id,
  revision,
  onChanged,
  onOpen,
  onNew,
  registerLeave,
}: {
  id: string;
  revision: number;
  onChanged: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  registerLeave: (handler: (() => Promise<boolean>) | undefined) => void;
}) {
  const [topic, setTopic] = useState<Topic>(),
    [form, setForm] = useState<TopicForm>(),
    [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const [items, setItems] = useState<Entry[]>([]),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false),
    [history, setHistory] =
      useState<{ id: string; title: string; revision: number; created_at: string }[]>(),
    [historyView, setHistoryView] = useState<any>();
  const [savedDraft, setSavedDraft] = useState<{
      form: TopicForm;
      baseRevision: number;
      savedAt: string;
    } | null>(null),
    [draftStatus, setDraftStatus] = useState('');
  const [aiDraft, setAiDraft] = useState<AiDraft>(),
    [review, setReview] = useState(''),
    [reviewTitle, setReviewTitle] = useState(''),
    [insufficient, setInsufficient] = useState('');
  const [busy, setBusy] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const controller = useRef<AbortController | null>(null),
    request = useRef(0),
    draftQueue = useRef<Promise<any>>(Promise.resolve());
  const loadSequence = useRef(0),
    editingRef = useRef(editing);
  editingRef.current = editing;
  const formRef = useRef(form);
  formRef.current = form;
  const reviewQueue = useRef<Promise<any>>(Promise.resolve());
  const reviewDirty =
    !!aiDraft &&
    (reviewTitle !== (aiDraft.reviewTitle ?? aiDraft.suggestion.title) ||
      review !== (aiDraft.review ?? previewText(aiDraft)));
  const dirty = !!topic && !!form && JSON.stringify(form) !== JSON.stringify(topicForm(topic));
  const load = async () => {
    const seq = ++loadSequence.current;
    try {
      const [doc, manual, ai, list] = await Promise.all([
        api<Topic>('/collections/' + id),
        api<any>('/collections/' + id + '/drafts/manual'),
        api<any>('/collections/' + id + '/drafts/ai'),
        api<{ items: Entry[] }>('/entries?collections=' + encodeURIComponent(id) + '&page=' + page),
      ]);
      if (seq !== loadSequence.current) return;
      setTopic(doc);
      setItems(list.items);
      if (page > Math.max(1, Math.ceil(doc.count / 24)))
        setPage(Math.max(1, Math.ceil(doc.count / 24)));
      setSavedDraft(manual);
      if (!editingRef.current) setForm(topicForm(doc));
      if (ai && !aiDraft && !editingRef.current) {
        setAiDraft(ai);
        setReview(ai.review ?? previewText(ai));
        setReviewTitle(ai.reviewTitle ?? ai.suggestion.title);
      }
      setError('');
    } catch (e) {
      if (seq === loadSequence.current) setError((e as Error).message);
    } finally {
      if (seq === loadSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    setLoading(true);
    load();
    return () => {
      loadSequence.current++;
    };
  }, [id, page, revision]);
  useEffect(
    () => () => {
      request.current++;
      controller.current?.abort();
    },
    [],
  );
  const storeDraft = (value: TopicForm) => {
    setDraftStatus('正在保存专题草稿…');
    const task = draftQueue.current
      .catch(() => {})
      .then(() =>
        api('/collections/' + id + '/drafts/manual', {
          method: 'PUT',
          body: JSON.stringify(value),
        }),
      );
    draftQueue.current = task;
    task
      .then(() => setDraftStatus('专题草稿已保存在本机'))
      .catch((e) => setDraftStatus('草稿保存失败：' + e.message));
    return task;
  };
  const storeReview = () => {
    if (!aiDraft) return Promise.resolve();
    const payload = { id: aiDraft.id, reviewTitle, review };
    setDraftStatus('正在保存 AI 审核草稿…');
    const task = reviewQueue.current
      .catch(() => {})
      .then(() =>
        api<AiDraft>('/collections/' + id + '/drafts/ai', {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      );
    reviewQueue.current = task;
    task
      .then((d) => {
        setAiDraft((p) => (p?.id === d.id ? d : p));
        setDraftStatus('AI 审核草稿已独立保存');
      })
      .catch((e) => setDraftStatus('AI 草稿保存失败：' + e.message));
    return task;
  };
  useEffect(() => {
    if (!aiDraft || !reviewDirty || busy || aiBusy || editing) return;
    const timer = setTimeout(storeReview, 650);
    return () => clearTimeout(timer);
  }, [review, reviewTitle, reviewDirty, busy, aiBusy, editing]);
  useEffect(() => {
    if (!editing || !dirty || busy || !form) return;
    const timer = setTimeout(() => storeDraft(form), 650);
    return () => clearTimeout(timer);
  }, [form, editing, dirty, busy]);
  const leave = async () => {
    if (aiBusy || busy || uploading) {
      setError('正在处理，请先取消 AI 或等待保存/上传完成。');
      return false;
    }
    if (reviewDirty) {
      try {
        await storeReview();
      } catch {
        setError('AI 审核草稿未保存，请保留此页。');
        return false;
      }
    }
    if (editing && dirty) {
      if (!confirm('专题内容未正式保存，保留独立专题草稿并离开？')) return false;
      try {
        await storeDraft(formRef.current!);
      } catch {
        setError('专题草稿保存失败，请保留此页。');
        return false;
      }
    }
    setEditing(false);
    return true;
  };
  useEffect(() => {
    registerLeave(leave);
    return () => registerLeave(undefined);
  }, [form, dirty, editing, busy, aiBusy, uploading, review, reviewTitle, reviewDirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ((dirty && editing) || aiBusy || reviewDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, editing, aiBusy, reviewDirty]);
  const save = async () => {
    if (!form || busy || uploading || aiBusy) return;
    setBusy(true);
    setError('');
    try {
      await draftQueue.current.catch(() => {});
      await reviewQueue.current.catch(() => {});
      const doc = await api<Topic>('/collections/' + id, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setTopic(doc);
      setForm(topicForm(doc));
      setEditing(false);
      setSavedDraft(null);
      setAiDraft(undefined);
      setDraftStatus('专题已正式保存，上一版可在历史中恢复');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      await reviewQueue.current.catch(() => {});
      await api('/collections/' + id + '/drafts/ai', { method: 'DELETE' });
      setAiDraft(undefined);
      setInsufficient('已拒绝 AI 草稿，正式总结保持原样。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (selected.length < 3 || selected.length > 10 || aiBusy || editing) return;
    if (aiDraft && !confirm('重新生成将替换当前未采用的 AI 草稿，正式总结不变。')) return;
    const seq = ++request.current,
      c = new AbortController();
    controller.current = c;
    setAiBusy(true);
    setError('');
    setInsufficient('');
    try {
      await reviewQueue.current.catch(() => {});
      const result = await api<any>('/ai/suggest', {
        method: 'POST',
        signal: c.signal,
        body: JSON.stringify({ mode: 'collection', collectionId: id, ids: selected }),
      });
      if (seq !== request.current) return;
      if (result.suggestion.status === 'insufficient') {
        setInsufficient(result.suggestion.reason);
        return;
      }
      const d: AiDraft = {
        id: result.draftId,
        suggestion: result.suggestion,
        sources: result.sources,
        baseRevision: result.revision,
      };
      setAiDraft(d);
      setReview(previewText(d));
      setReviewTitle(d.suggestion.title);
    } catch (e) {
      if (seq === request.current && !c.signal.aborted) setError((e as Error).message);
    } finally {
      if (seq === request.current) setAiBusy(false);
    }
  };
  const adopt = (mode: 'append' | 'replace') => {
    if (!topic || !aiDraft) return;
    if (savedDraft) {
      setError('请先恢复或明确放弃已有专题编辑草稿，再采用 AI。');
      return;
    }
    if (aiDraft.baseRevision !== topic.revision) {
      setError('专题已更新，旧 AI 草稿不能采用，请重新生成。');
      return;
    }
    if (!reviewTitle.trim() || !review.trim()) {
      setError('整理稿标题和正文不能为空。');
      return;
    }
    if (
      mode === 'replace' &&
      !confirm('明确替换当前专题总结？只有正式保存后生效，保存时保留可恢复的上一版。')
    )
      return;
    const generated = reviewHtml(reviewTitle, review, aiDraft.sources);
    setForm({
      ...topicForm(topic),
      content: mode === 'append' ? topic.content + generated : generated,
      aiDraftId: aiDraft.id,
      adoptMode: mode,
    });
    setEditing(true);
    setDraftStatus('已采用至专题编辑草稿，尚未正式保存');
  };
  const remove = async (entry: Entry) => {
    if (!confirm('从专题移除「' + entry.title + '」？原收藏及其他专题关联保留。')) return;
    setBusy(true);
    try {
      await api('/collections/' + id + '/resources', {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', ids: [entry.id] }),
      });
      setSelected((p) => p.filter((x) => x !== entry.id));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!topic) return <div role="status">{loading ? '正在载入专题…' : error || '专题不可用'}</div>;
  const patch = (p: Partial<TopicForm>) => setForm((f) => (f ? { ...f, ...p } : f));
  return (
    <section className="collection-page" aria-label={'专题详情 ' + topic.name}>
      <header className="collection-hero">
        <div>
          <div className="eyebrow">COLLECTION · UNDERSTAND · REFLECT</div>
          <h1>{topic.name}</h1>
          <p>{topic.introduction || '围绕一个问题，收录参考，沉淀自己的理解。'}</p>
          <small>
            {topic.count} 条资源 ·{' '}
            {topic.updated_at
              ? '总结更新于 ' + new Date(topic.updated_at).toLocaleString('zh-CN')
              : '尚未编写总结'}
          </small>
        </div>
        <BookOpen size={44} />
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {savedDraft && !editing && (
        <div className="draft-recovery">
          <strong>发现独立专题编辑草稿</strong>
          <p>
            不会覆盖收藏/原创笔记的 workspace 草稿。
            {savedDraft.baseRevision !== topic.revision ? ' 专题已有更新，恢复前请核对版本。' : ''}
          </p>
          <button
            onClick={() => {
              const stale = savedDraft.baseRevision !== topic.revision;
              if (stale && savedDraft.form.aiDraftId) {
                setError('该草稿采用了旧 AI 建议，请保留草稿文字，放弃旧草稿后重新生成并审核。');
                return;
              }
              if (
                stale &&
                !confirm(
                  '正式总结已更新。恢复此草稿并以当前版本继续编辑？请核对内容；保存时会保留当前正式版本。',
                )
              )
                return;
              setForm({ ...savedDraft.form, revision: topic.revision });
              setEditing(true);
            }}
          >
            恢复专题草稿
          </button>
          <button
            onClick={async () => {
              if (confirm('放弃专题编辑草稿？正式总结不变。')) {
                await api('/collections/' + id + '/drafts/manual', { method: 'DELETE' });
                setSavedDraft(null);
              }
            }}
          >
            放弃专题草稿
          </button>
        </div>
      )}
      <section className="collection-summary">
        <div className="section-heading">
          <h2>知识总结</h2>
          {!editing && (
            <div>
              <button
                onClick={async () => {
                  try {
                    setHistory(await api('/collections/' + id + '/versions'));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                历史版本
              </button>
              <button
                className="primary"
                disabled={aiBusy || !!savedDraft}
                onClick={() => {
                  setForm(topicForm(topic));
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
                编辑总结
              </button>
            </div>
          )}
        </div>
        {editing && form ? (
          <div className="collection-editor">
            <fieldset disabled={busy}>
              <label>
                专题标题
                <input
                  aria-label="专题标题"
                  value={form.name}
                  maxLength={50}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                专题介绍
                <textarea
                  aria-label="专题介绍"
                  value={form.introduction}
                  maxLength={2000}
                  onChange={(e) => patch({ introduction: e.target.value })}
                />
              </label>
              <RichEditor
                key={form.aiDraftId || 'manual'}
                content={form.content}
                onChange={(content) => patch({ content })}
                onError={setError}
                onBusy={setUploading}
                disabled={busy}
              />
            </fieldset>
            <div className="collection-save">
              <small role="status">{draftStatus || '专题总结和草稿独立持久化'}</small>
              <button
                disabled={busy || uploading}
                onClick={async () => {
                  if (await leave()) {
                    setForm(topicForm(topic));
                    await load();
                  }
                }}
              >
                取消编辑
              </button>
              <button className="primary" disabled={busy || uploading} onClick={save}>
                保存专题
              </button>
            </div>
          </div>
        ) : topic.content ? (
          <div
            className="prose collection-prose"
            onClick={(e) => {
              const link = (e.target as HTMLElement).closest('a[data-entry-id]');
              if (link) {
                e.preventDefault();
                onOpen(link.getAttribute('data-entry-id')!);
              }
            }}
            dangerouslySetInnerHTML={{ __html: topic.content }}
          />
        ) : (
          <div className="collection-empty">
            <BookOpen size={26} />
            <p>还没有知识总结。先整理几条资源，再把理解写在这里。</p>
          </div>
        )}
        {!editing && topic.sources.length > 0 && (
          <details className="collection-sources">
            <summary>保存时的来源引用 · {topic.sources.length} 条</summary>
            {topic.sources.map((s) => (
              <div key={s.id}>
                <button className="text-button" onClick={() => onOpen(s.id)}>
                  {s.title}
                </button>
                <small>{s.evidence ? '有可用文字资料' : '仅标题/来源，内容未读取'}</small>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    原始来源 <ArrowUpRight size={12} />
                  </a>
                )}
              </div>
            ))}
          </details>
        )}
      </section>
      {!editing && (
        <section className="collection-ai">
          <div className="section-heading">
            <div>
              <h2>
                AI 综合整理 <small>可选 · 人工审核</small>
              </h2>
              <p className="muted">
                选择 3–10
                条当前专题资源。只发送选中标题、简介、笔记文字与必要来源标识；不访问网页/视频。总预算
                12000 字符，超出明确拒绝。
              </p>
            </div>
            <button
              disabled={selected.length < 3 || selected.length > 10 || aiBusy || busy}
              onClick={generate}
            >
              <Sparkles size={16} />
              综合整理所选 {selected.length ? `(${selected.length})` : ''}
            </button>
          </div>
          {aiBusy && (
            <div role="status">
              正在生成专题候选…{' '}
              <button
                onClick={() => {
                  request.current++;
                  controller.current?.abort();
                  setAiBusy(false);
                  setInsufficient('AI 请求已取消，正式总结不变。');
                }}
              >
                取消专题 AI 请求
              </button>
            </div>
          )}
          {insufficient && <p role="status">{insufficient}</p>}
          {aiDraft && (
            <div className="ai-review" aria-label="专题 AI 草稿审核">
              {savedDraft && (
                <p className="muted">已有专题编辑草稿，请先恢复或明确放弃，再采用本次 AI 建议。</p>
              )}
              <strong>AI 综合草稿 · 尚未保存</strong>
              <p role="status" className="ai-feedback">
                {draftStatus || 'AI 草稿已独立保存在本机，正式总结保持原样。'}
              </p>
              <p>{aiDraft.suggestion.reason}</p>
              <label>
                整理稿标题
                <input
                  aria-label="专题 AI 推荐标题"
                  disabled={busy || aiBusy}
                  value={reviewTitle}
                  maxLength={200}
                  onChange={(e) => setReviewTitle(e.target.value)}
                />
              </label>
              <label>
                可编辑整理稿
                <textarea
                  className="ai-note-preview"
                  aria-label="专题 AI 整理稿"
                  disabled={busy || aiBusy}
                  value={review}
                  maxLength={50000}
                  onChange={(e) => setReview(e.target.value)}
                />
              </label>
              <p className="muted">
                〔来源数字〕对应以下真实来源，采用时转换为站内引用。来源是否仍有效将在保存时再次校验。
              </p>
              <ol>
                {aiDraft.sources.map((s) => (
                  <li key={s.id}>
                    {s.title} · {s.evidence ? '可用文字' : '仅标题，未读内容'}
                  </li>
                ))}
              </ol>
              <div className="ai-review-actions">
                <button disabled={aiBusy || busy} onClick={reject}>
                  拒绝专题 AI 草稿
                </button>
                <button
                  disabled={
                    aiBusy || busy || !!savedDraft || aiDraft.baseRevision !== topic.revision
                  }
                  onClick={() => adopt('replace')}
                >
                  替换原总结
                </button>
                <button
                  className="primary"
                  disabled={
                    aiBusy || busy || !!savedDraft || aiDraft.baseRevision !== topic.revision
                  }
                  onClick={() => adopt('append')}
                >
                  追加到原总结
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <section className="collection-resources">
        <div className="section-heading">
          <div>
            <h2>
              资源合集 <span className="count-badge">{topic.count}</span>
            </h2>
            <p className="muted">多专题共享原收藏，不复制记录。勾选卡片用于本次综合整理。</p>
          </div>
          <div>
            <button disabled={editing || busy || aiBusy} onClick={() => setPicker(true)}>
              <Plus size={16} />
              添加已有资源
            </button>
            <button disabled={editing || aiBusy} onClick={onNew}>
              新建收藏到专题
            </button>
            {selected.length > 0 && <button onClick={() => setSelected([])}>清除所选</button>}
          </div>
        </div>
        {items.length ? (
          <div className="grid">
            {items.map((entry) => (
              <article
                className={'card ' + (selected.includes(entry.id) ? 'is-selected' : '')}
                key={entry.id}
              >
                <label className="card-select">
                  <input
                    type="checkbox"
                    aria-label={'综合整理选择 ' + entry.title}
                    checked={selected.includes(entry.id)}
                    disabled={
                      editing || aiBusy || (selected.length >= 10 && !selected.includes(entry.id))
                    }
                    onChange={(e) =>
                      setSelected((p) =>
                        e.target.checked ? [...p, entry.id] : p.filter((x) => x !== entry.id),
                      )
                    }
                  />
                </label>
                <button
                  className="card-main"
                  aria-label={'查看 ' + entry.title}
                  onClick={() => onOpen(entry.id)}
                >
                  <Cover entry={entry} />
                  <div className="card-body">
                    <div className="card-source">{source(entry)}</div>
                    <h3>{entry.title}</h3>
                    <p>{entry.description || '打开收藏，查看已有笔记。'}</p>
                    <div className="chips">
                      {entry.tags.slice(0, 2).map((t) => (
                        <span key={t.id}>#{t.name}</span>
                      ))}
                    </div>
                  </div>
                </button>
                <div className="card-footer">
                  <small>原始收藏</small>
                  <div>
                    <button
                      className="icon"
                      aria-label={'从专题移除 ' + entry.title}
                      disabled={editing || aiBusy || busy}
                      onClick={() => remove(entry)}
                      title="仅移除专题关联"
                    >
                      <X size={15} />
                    </button>
                    {entry.url && (
                      <a
                        className="icon"
                        aria-label={'打开原网站 ' + entry.title}
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="collection-empty">
            <p>专题还没有资源，添加已有收藏或新建一条。</p>
          </div>
        )}
        {topic.count > 24 && (
          <div className="pagination">
            <span>
              第 {page} / {Math.ceil(topic.count / 24)} 页
            </span>
            <button aria-label="专题上一页" disabled={page === 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="专题下一页"
              disabled={page * 24 >= topic.count}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>
      {picker && (
        <ResourcePicker
          topicId={id}
          onClose={() => setPicker(false)}
          onAdded={() => {
            setPicker(false);
            onChanged();
          }}
        />
      )}
      {history && (
        <Dialog
          title="专题历史版本"
          onClose={() => {
            setHistory(undefined);
            setHistoryView(undefined);
          }}
          wide
        >
          <div className="settings-panel">
            {history.length ? (
              history.map((v) => (
                <button
                  className="history-row"
                  key={v.id}
                  onClick={async () =>
                    setHistoryView(await api('/collections/' + id + '/versions/' + v.id))
                  }
                >
                  版本 {v.revision} · {v.title} · {new Date(v.created_at).toLocaleString('zh-CN')}
                </button>
              ))
            ) : (
              <p>尚无历史版本。每次保存会保留上一版。</p>
            )}
            {historyView && (
              <section>
                <h3>{historyView.title}</h3>
                <div className="prose" dangerouslySetInnerHTML={{ __html: historyView.content }} />
                <button
                  className="primary"
                  onClick={async () => {
                    if (
                      !confirm('恢复这版专题总结？当前版本会先保留，本专题草稿会清除，收藏不变。')
                    )
                      return;
                    try {
                      await api('/collections/' + id + '/versions/' + historyView.id + '/restore', {
                        method: 'POST',
                        body: JSON.stringify({ confirm: '恢复专题版本', revision: topic.revision }),
                      });
                      setHistory(undefined);
                      setHistoryView(undefined);
                      setAiDraft(undefined);
                      setSavedDraft(null);
                      onChanged();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  恢复此专题版本
                </button>
              </section>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
function ResourcePicker({
  topicId,
  onClose,
  onAdded,
}: {
  topicId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [items, setItems] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [ids, setIds] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api<any>('/entries?' + new URLSearchParams({ q: query, page: String(page) }))
      .then((d) => {
        if (current) {
          setItems(d.items);
          setTotal(d.total);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [query, page]);
  return (
    <Dialog
      title="添加已有资源到专题"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="settings-panel">
        <input
          aria-label="搜索待添加资源"
          placeholder="搜索标题、简介或笔记…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {items.map((e) => (
          <label className="resource-picker-row" key={e.id}>
            <input
              type="checkbox"
              aria-label={'添加资源 ' + e.title}
              checked={ids.includes(e.id)}
              disabled={busy || e.collections.some((c) => c.id === topicId)}
              onChange={(event) =>
                setIds((p) => (event.target.checked ? [...p, e.id] : p.filter((x) => x !== e.id)))
              }
            />
            <span>
              {e.title}
              <small>
                {source(e)}
                {e.collections.some((c) => c.id === topicId) ? ' · 已在专题' : ''}
              </small>
            </span>
          </label>
        ))}
        {!items.length && <p>没有匹配的收藏。</p>}
        {error && <p className="error">{error}</p>}
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            上一页资源
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / 24))}
          </span>
          <button disabled={page * 24 >= total} onClick={() => setPage(page + 1)}>
            下一页资源
          </button>
        </div>
        <button
          className="primary"
          disabled={busy || !ids.length || ids.length > 100}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/collections/' + topicId + '/resources', {
                method: 'POST',
                body: JSON.stringify({ action: 'add', ids }),
              });
              onAdded();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          添加所选资源 ({ids.length})
        </button>
      </div>
    </Dialog>
  );
}
