import { useHistoryGuard } from './useHistoryGuard';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './components';
import { RichEditor } from './RichEditor';
import { api, labels, type Entry, type Kind, type Meta } from './shared';
import {
  knowledgeLabels,
  stateLabels,
  epistemicLabels,
  sourceLabels,
  knowledgeWrite,
  directoryLabel,
  type Directory,
  type KnowledgeForm,
} from './knowledgeTypes';
export function KnowledgeEditor({
  id,
  initial,
  dirs,
  meta,
  onClose,
  onSaved,
}: {
  id?: string;
  initial: KnowledgeForm;
  dirs: Directory[];
  meta: Meta;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [ready, setReady] = useState(false),
    [resume, setResume] = useState<KnowledgeForm | null>(null),
    [key, setKey] = useState(0),
    [draftStatus, setDraftStatus] = useState(''),
    [q, setQ] = useState(''),
    [resources, setResources] = useState<Entry[]>([]);
  const queue = useRef<Promise<any>>(Promise.resolve()),
    draftKey = id || 'new',
    dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useHistoryGuard(dirty, busy || uploading, onClose);
  const patch = (value: Partial<KnowledgeForm>) => setForm((f) => ({ ...f, ...value }));
  useEffect(() => {
    let current = true;
    api('/knowledge/drafts/' + draftKey)
      .then((d) => {
        if (current) {
          setResume(d?.form || null);
          setReady(true);
        }
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      current = false;
    };
  }, [draftKey]);
  const storeDraft = (value: KnowledgeForm) => {
    const pending = queue.current
      .catch(() => {})
      .then(() => knowledgeWrite('/drafts/' + draftKey, 'PUT', value));
    queue.current = pending;
    pending
      .then(() => setDraftStatus('知识草稿已保存在本机'))
      .catch((e) => setDraftStatus('草稿保存失败：' + e.message));
    return pending;
  };
  useEffect(() => {
    if (!dirty || !ready || resume || busy) return;
    const timer = setTimeout(() => storeDraft(form), 650);
    return () => clearTimeout(timer);
  }, [form, ready, resume, busy]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => {
    if (form.kind !== 'page') return;
    let active = true;
    const t = setTimeout(
      () =>
        api('/entries?' + new URLSearchParams({ q }))
          .then((d) => {
            if (active) setResources(d.items.filter((e: Entry) => e.id !== id));
          })
          .catch((e) => setError(e.message)),
      200,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, form.kind, id]);
  const close = async () => {
    if (busy || uploading) return;
    if (dirty) {
      if (!confirm('知识尚未正式保存，保留本地草稿并关闭？')) return;
      try {
        await storeDraft(form);
      } catch {
        setError('草稿保存失败，请保留编辑窗口。');
        return;
      }
    }
    onClose();
  };
  const newSource = form.newSource || {
    kind: 'inspiration' as const,
    title: '用户提供资料',
    url: null,
    excerpt: '',
    original_date: null,
    date_note: '',
  };
  return (
    <Dialog title={id ? '编辑知识' : '收集与新建知识'} wide onClose={close}>
      <form
        className="entry-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || uploading) return;
          if (
            form.status === 'confirmed' &&
            !confirm('确认此版本为你已核对的判断？这不代表来源已被网站验证。')
          )
            return;
          setBusy(true);
          setError('');
          try {
            await queue.current.catch(() => {});
            const r = await knowledgeWrite('/records' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
              ...form,
              confirm: form.status === 'confirmed' ? '确认判断' : '',
            });
            onSaved(r.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {resume && (
          <div className="draft-notice">
            <strong>发现独立知识草稿</strong>
            <p>正式内容保持不变，恢复后请核对分类与版本。</p>
            <button
              type="button"
              onClick={() => {
                if (
                  id &&
                  resume.updated_at !== initial.updated_at &&
                  !confirm(
                    '正式知识已更新。恢复这份旧草稿前请确认，并在保存前核对差异；不会自动覆盖。',
                  )
                )
                  return;
                setForm({
                  ...resume,
                  revision: initial.revision,
                  updated_at: initial.updated_at,
                  directory_id: dirs.some((d) => d.id === resume.directory_id)
                    ? resume.directory_id
                    : null,
                  domains: resume.domains.filter((id) => meta.domains.some((t) => t.id === id)),
                  tags: resume.tags.filter((id) => meta.tags.some((t) => t.id === id)),
                  collections: resume.collections.filter((id) =>
                    meta.collections.some((t) => t.id === id),
                  ),
                });
                setDraftStatus('草稿已恢复；已删除的分类/目录不再选中，请核对后保存。');
                setKey((n) => n + 1);
                setResume(null);
              }}
            >
              恢复知识草稿
            </button>
            <button
              type="button"
              onClick={async () => {
                if (confirm('确认放弃这份知识草稿？')) {
                  await knowledgeWrite('/drafts/' + draftKey, 'DELETE', {});
                  setResume(null);
                }
              }}
            >
              放弃知识草稿
            </button>
          </div>
        )}
        <fieldset className="editor-fields" disabled={busy || !!resume || !ready}>
          <label>
            标题
            <input
              aria-label="知识标题"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <div className="knowledge-fields">
            <label>
              对象类型
              <select
                aria-label="知识类型"
                value={form.kind}
                onChange={(e) =>
                  patch({
                    kind: e.target.value as KnowledgeForm['kind'],
                    references: e.target.value === 'page' ? form.references : [],
                  })
                }
              >
                {Object.entries(knowledgeLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              主要领域
              <select
                aria-label="主要领域"
                value={form.primary_domain_id || ''}
                onChange={(e) => patch({ primary_domain_id: e.target.value || null })}
              >
                <option value="">不指定</option>
                {meta.domains
                  .filter((d) => form.domains.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
              <small>其他选中的领域保留为跨领域关联。</small>
            </label>
            <label>
              优先级
              <select
                aria-label="知识优先级"
                value={form.priority}
                onChange={(e) => patch({ priority: Number(e.target.value) })}
              >
                {['普通', '关注', '重要', '最高'].map((v, i) => (
                  <option key={i} value={i}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select
                aria-label="知识状态"
                value={form.status}
                onChange={(e) => patch({ status: e.target.value as KnowledgeForm['status'] })}
              >
                {Object.entries(stateLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              内容性质
              <select
                aria-label="知识性质"
                value={form.epistemic}
                onChange={(e) => patch({ epistemic: e.target.value as KnowledgeForm['epistemic'] })}
              >
                {Object.entries(epistemicLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              有证据的原始日期
              <input
                aria-label="知识原始日期"
                type="date"
                value={form.original_date || ''}
                onChange={(e) => patch({ original_date: e.target.value || null })}
              />
            </label>
          </div>
          <label>
            资料提供的记录时间
            <input
              aria-label="资料记录时间"
              placeholder="可选带时区 ISO 时间；未知留空"
              value={form.provided_recorded_at || ''}
              onChange={(e) => patch({ provided_recorded_at: e.target.value || null })}
            />
          </label>
          <label>
            日期说明
            <input
              aria-label="知识日期说明"
              maxLength={300}
              placeholder="未知时留空；此处不是今天的整理日期"
              value={form.date_note}
              onChange={(e) => patch({ date_note: e.target.value })}
            />
          </label>
          <label>正文 · 图片沿用本地附件</label>
          <RichEditor
            key={key}
            content={form.content}
            onChange={(content) => patch({ content })}
            onError={setError}
            onBusy={setUploading}
            disabled={busy || !!resume}
          />
          <label>
            待验证问题
            <textarea
              aria-label="待验证问题"
              maxLength={10000}
              value={form.questions}
              onChange={(e) => patch({ questions: e.target.value })}
            />
          </label>
          <div className="taxonomy-selects">
            {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
              <div key={k}>
                <label>{labels[k]}</label>
                <div className="choice-wrap">
                  {meta[k].map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      aria-pressed={form[k].includes(t.id)}
                      className={form[k].includes(t.id) ? 'selected' : ''}
                      onClick={() =>
                        patch({
                          ...(k === 'domains' &&
                          form.primary_domain_id === t.id &&
                          form[k].includes(t.id)
                            ? { primary_domain_id: null }
                            : {}),
                          [k]: form[k].includes(t.id)
                            ? form[k].filter((v) => v !== t.id)
                            : [...form[k], t.id],
                        })
                      }
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {form.kind === 'page' && (
            <details className="knowledge-source-box">
              <summary>关联已有资源 · 已选 {form.references.length} 条</summary>
              <p className="muted">
                可混合引用知识、收藏、笔记及工具，不复制；已选但不在搜索结果中的引用保留。
              </p>
              <input
                aria-label="搜索混合页面资源"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="按标题、简介、正文搜索；当前页最多24条"
              />
              <div className="knowledge-reference-picker">
                {resources.map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={form.references.includes(r.id)}
                      onChange={(e) =>
                        patch({
                          references: e.target.checked
                            ? [...form.references, r.id]
                            : form.references.filter((v) => v !== r.id),
                        })
                      }
                    />
                    {r.title}
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => patch({ references: [] })}>
                清空引用选择
              </button>
            </details>
          )}
          <details className="knowledge-source-box">
            <summary>补充来源与原始摘录（可选）</summary>
            <p className="muted">
              来源由你提供，未访问网址或读取聊天历史；保存后原始来源独立保留。
            </p>
            <select
              aria-label="来源类型"
              value={newSource.kind}
              onChange={(e) =>
                patch({
                  newSource: { ...newSource, kind: e.target.value as typeof newSource.kind },
                })
              }
            >
              {Object.entries(sourceLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="来源标题"
              value={newSource.title}
              maxLength={200}
              onChange={(e) => patch({ newSource: { ...newSource, title: e.target.value } })}
            />
            <input
              aria-label="来源网址"
              type="url"
              value={newSource.url || ''}
              maxLength={4096}
              placeholder="可选 HTTP/HTTPS"
              onChange={(e) => patch({ newSource: { ...newSource, url: e.target.value || null } })}
            />
            <input
              aria-label="来源原始日期"
              type="date"
              value={newSource.original_date || ''}
              onChange={(e) =>
                patch({ newSource: { ...newSource, original_date: e.target.value || null } })
              }
            />
            <textarea
              aria-label="原始摘录"
              value={newSource.excerpt}
              maxLength={100000}
              rows={5}
              onChange={(e) => patch({ newSource: { ...newSource, excerpt: e.target.value } })}
            />
          </details>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="form-footer">
            <small role="status">
              {draftStatus || '原资料与新判断分开记录；保存才写正式知识。'}
            </small>
            <button type="button" onClick={close}>
              取消
            </button>
            <button className="primary" disabled={uploading || busy}>
              {busy ? '保存中…' : '保存知识'}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
