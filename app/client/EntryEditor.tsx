import { useHistoryGuard } from './useHistoryGuard';
import { useEffect, useRef, useState, useCallback } from 'react';
import { FileText, ArrowUpRight, ImagePlus, Check, Bookmark } from 'lucide-react';
import { api, labels, toolLabels, type ToolKind, type Kind, type Form, type Meta } from './shared';
import { Dialog } from './components';
import { RichEditor } from './RichEditor';
import { AiAssist } from './AiAssist';
import { ShareAssist } from './ShareAssist';
import { ReadingSurface } from './Experience';
export function EntryEditor({
  initial,
  meta,
  onClose,
  onSaved,
  onExisting,
  onCreated,
  embedded = false,
}: {
  initial: { id?: string; form: Form; cover?: string | null; updatedAt?: string };
  meta: Meta;
  onClose: () => void;
  onSaved: () => void;
  onExisting: (id: string) => void;
  onCreated: () => void;
  embedded?: boolean;
}) {
  const [form, setForm] = useState(initial.form);
  const [shareText, setShareText] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [cover, setCover] = useState(initial.cover ? '/assets/' + initial.cover : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const [resume, setResume] = useState<{
    form: Form;
    savedAt: string;
    baseUpdatedAt: string;
    cover?: string;
  } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [createKind, setCreateKind] = useState<Kind | null>(null);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const noteAction = useRef<(() => void) | undefined>(undefined);
  const registerNoteAction = useCallback((action: (() => void) | undefined) => {
    noteAction.current = action;
  }, []);
  const draftQueue = useRef<Promise<any>>(Promise.resolve());
  const formRef = useRef<HTMLFormElement>(null);
  const isTool = form.resource_kind === 'tool';
  const draftKey = initial.id || (initial.form.resource_kind === 'tool' ? 'new-tool' : 'new');
  useEffect(() => {
    if (draftReady && !resume && !initial.id)
      formRef.current
        ?.querySelector<HTMLElement>(
          form.type === 'bookmark' ? 'input[aria-label="网址"]' : 'input[aria-label="标题"]',
        )
        ?.focus();
  }, [draftReady, !!resume, form.type]);
  const [bodyUploading, setBodyUploading] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.form);
  useHistoryGuard(dirty, saving || uploading || bodyUploading || aiBusy || shareBusy, onClose);
  const patch = (value: Partial<Form>) => {
    setForm((f) => ({ ...f, ...value }));
    if (value.url !== undefined || value.type !== undefined) setDuplicate(null);
  };
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
    let current = true;
    api('/drafts/' + draftKey)
      .then((d) => {
        if (current) {
          setResume(d);
          setDraftReady(true);
        }
      })
      .catch((e) => {
        if (current) {
          setDraftStatus('草稿读取失败：' + e.message);
          setDraftReady(true);
        }
      });
    return () => {
      current = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if ((form.type !== 'bookmark' && !isTool) || !form.url) {
      setDuplicate(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api('/duplicate?' + new URLSearchParams({ url: form.url, exclude: initial.id || '' }))
        .then((d) => {
          if (current) setDuplicate(d.duplicate);
        })
        .catch(() => {});
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [form.url, form.type, initial.id]);
  const storeDraft = (value: Form) => {
    setDraftStatus('正在保存草稿…');
    const task = draftQueue.current
      .catch(() => {})
      .then(() =>
        api('/drafts/' + draftKey, {
          method: 'PUT',
          body: JSON.stringify({ form: value, baseUpdatedAt: initial.updatedAt || '' }),
        }),
      );
    draftQueue.current = task;
    task
      .then(() => setDraftStatus('草稿已保存在本机'))
      .catch((e) => setDraftStatus('草稿保存失败：' + e.message));
    return task;
  };
  useEffect(() => {
    if (!dirty || !draftReady || resume || saving) return;
    const timer = setTimeout(() => storeDraft(form), 650);
    return () => clearTimeout(timer);
  }, [form, draftReady, resume, saving]);
  const recover = () => {
    if (!resume) return;
    const f = {
      ...resume.form,
      ...Object.fromEntries(
        (['domains', 'tags', 'collections'] as Kind[]).map((k) => [
          k,
          resume.form[k].filter((id) => meta[k].some((t) => t.id === id)),
        ]),
      ),
    };
    setForm(f);
    setCover(resume.cover ? '/assets/' + resume.cover : '');
    setEditorKey((n) => n + 1);
    setResume(null);
    setDraftStatus('草稿已恢复，请核对后保存');
  };
  const close = async () => {
    if (aiBusy) {
      setError('AI 正在处理，请先取消 AI 请求或等待采用完成。');
      return;
    }
    if (saving || uploading || bodyUploading || shareBusy) {
      setError('正在保存或上传，请稍候再关闭。');
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    if (!confirm('内容尚未保存为正式条目。保留本地草稿并关闭？')) return;
    try {
      await storeDraft(form);
      onClose();
    } catch {
      setError('草稿未能保存，请保留窗口并重试。');
    }
  };
  const save = async (allowDuplicate = false) => {
    if (saving || uploading || bodyUploading || aiBusy || shareBusy) return;
    if (form.type === 'bookmark' || (isTool && form.url.trim())) {
      try {
        if (!['http:', 'https:'].includes(new URL(form.url).protocol)) throw Error();
      } catch {
        setError('请输入有效的 http/https 网址。');
        return;
      }
    }
    if (!form.title.trim()) {
      setError('请填写标题。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await draftQueue.current.catch(() => {});
      await api('/entries' + (initial.id ? '/' + initial.id : ''), {
        method: initial.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, allowDuplicate }),
      });
      try {
        await api('/drafts/' + draftKey, { method: 'DELETE' });
      } catch {
        /* Entry is already saved; do not retry it because draft cleanup failed. */
      }
      onSaved();
    } catch (e) {
      const err = e as Error & { duplicate?: { id: string; title: string } };
      if (err.duplicate) {
        setDuplicate(err.duplicate);
        setError('这个网址已收藏为「' + err.duplicate.title + '」。你可以仍然保留一个新条目。');
      } else setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const Frame = embedded ? ReadingSurface : Dialog;
  return (
    <Frame
      title={
        isTool ? (initial.id ? '编辑工具' : '添加工具') : initial.id ? '编辑条目' : '留住新的灵感'
      }
      wide
      onClose={close}
    >
      <form
        ref={formRef}
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {resume && (
          <div className="draft-recovery">
            <strong>发现本地未保存草稿</strong>
            <p>
              {new Date(resume.savedAt).toLocaleString('zh-CN')}
              {initial.updatedAt && resume.baseUpdatedAt !== initial.updatedAt
                ? ' · 收藏已更新，请核对草稿后再保存。'
                : ''}
            </p>
            <button type="button" onClick={recover}>
              恢复草稿
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirm('确定放弃这份未保存草稿？正式条目不受影响。')) return;
                try {
                  await api('/drafts/' + draftKey, { method: 'DELETE' });
                  setResume(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              放弃旧草稿
            </button>
          </div>
        )}
        <fieldset
          className="editor-fields"
          disabled={!!resume || saving || !draftReady || shareBusy}
        >
          <p className="form-intro">
            {initial.id
              ? '编辑已有内容，修改后保存。'
              : isTool
                ? '收藏常用工具，网址可留空；备注记录你的使用经验。'
                : '只需填写网址和标题，其余信息可以稍后补充。'}
          </p>
          {!isTool && !initial.form.knowledge_kind && (
            <div className="type-tabs">
              <button
                type="button"
                className={form.type === 'bookmark' ? 'selected' : ''}
                onClick={() => patch({ type: 'bookmark' })}
              >
                <ArrowUpRight size={17} />
                收藏网址
              </button>
              <button
                type="button"
                className={form.type === 'note' ? 'selected' : ''}
                onClick={() => patch({ type: 'note' })}
              >
                <FileText size={17} />
                原创笔记
              </button>
            </div>
          )}
          {isTool && (
            <label>
              工具类型
              <select
                aria-label="工具类型"
                value={form.tool_kind}
                onChange={(e) => patch({ tool_kind: e.target.value as ToolKind })}
              >
                {Object.entries(toolLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(form.type === 'bookmark' || isTool) && (
            <label>
              网址 {isTool ? <small>可选 · 不下载或启动本地软件</small> : <span>*</span>}
              <input
                autoFocus={!initial.id}
                aria-label="网址"
                type="url"
                required={!isTool}
                maxLength={4096}
                value={form.url}
                placeholder="https://… · 仅手动输入，不自动抓取"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  try {
                    const url = new URL(text.trim());
                    if (['http:', 'https:'].includes(url.protocol) && !/\s/.test(text.trim()))
                      return;
                  } catch {}
                  if (text.trim()) {
                    e.preventDefault();
                    setShareText(text);
                  }
                }}
                onChange={(e) => patch({ url: e.target.value })}
              />
            </label>
          )}
          {form.type === 'bookmark' && (
            <ShareAssist
              form={form}
              meta={meta}
              raw={shareText}
              setRaw={setShareText}
              onBusy={setShareBusy}
              onApply={(value) =>
                setForm((f) => ({
                  ...f,
                  ...value,
                  title: f.title.trim() ? f.title : value.title || f.title,
                  tags: [...new Set([...f.tags, ...(value.tags || [])])],
                }))
              }
              onCreated={onCreated}
            />
          )}
          {duplicate && (
            <div className="duplicate-notice" role="status">
              <Bookmark size={18} />
              <div>
                <strong>这个网址已经收藏过</strong>
                <p>{duplicate.title}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (dirty) await storeDraft(form);
                      onClose();
                      onExisting(duplicate.id);
                    } catch {
                      setError('请先保存本地草稿后查看已有收藏。');
                    }
                  }}
                >
                  查看已有收藏
                </button>
                <button
                  type="button"
                  disabled={saving || uploading || bodyUploading}
                  onClick={() => save(true)}
                >
                  仍然保存重复网址
                </button>
              </div>
            </div>
          )}
          <label>
            标题 <span>*</span>
            <input
              aria-label="标题"
              required
              maxLength={200}
              value={form.title}
              placeholder="给这条收藏起一个容易找到的名字"
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label>
            简介 <small>可选</small>
            <textarea
              aria-label="简介"
              maxLength={2000}
              rows={2}
              value={form.description}
              placeholder="它有什么值得留下的地方？"
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <div className="cover-upload">
            <div>{cover ? <img src={cover} alt="封面预览" /> : <ImagePlus size={28} />}</div>
            <section>
              <strong>{isTool ? '工具图标' : '收藏封面'}</strong>
              <p>可选 · JPG / PNG / WebP / GIF · 最大 10 MB</p>
              <label className="button">
                {uploading ? '上传中…' : '选择图片'}
                <input
                  aria-label="上传封面"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const data = new FormData();
                      data.append('image', file);
                      const a = await api('/assets', { method: 'POST', body: data });
                      patch({ cover_asset_id: a.id });
                      setCover(a.url);
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              {cover && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    patch({ cover_asset_id: null });
                    setCover('');
                  }}
                >
                  移除封面
                </button>
              )}
            </section>
          </div>
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
          <div className="taxonomy-selects">
            {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
              <div key={k}>
                <label>
                  {labels[k]} <small>{k === 'domains' ? '不选则进入待整理' : '多选'}</small>
                </label>
                <div className="choice-wrap">
                  {[
                    ...(meta.recent?.[k] || []).filter((t) => meta[k].some((x) => x.id === t.id)),
                    ...meta[k].filter((t) => !(meta.recent?.[k] || []).some((x) => x.id === t.id)),
                  ].map((t) => (
                    <button
                      key={t.id}
                      aria-label={t.name}
                      type="button"
                      className={form[k].includes(t.id) ? 'selected' : ''}
                      onClick={() =>
                        patch({
                          ...(k === 'domains' &&
                          form.primary_domain_id === t.id &&
                          form[k].includes(t.id)
                            ? { primary_domain_id: null }
                            : {}),
                          [k]: form[k].includes(t.id)
                            ? form[k].filter((x) => x !== t.id)
                            : [...form[k], t.id],
                        })
                      }
                    >
                      {form[k].includes(t.id) && <Check size={12} />} {t.name}
                      {meta.recent?.[k].some((x) => x.id === t.id) && (
                        <small aria-hidden="true">最近</small>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setCreateKind(k);
                      setCreateName('');
                    }}
                  >
                    + 新建{labels[k]}
                  </button>
                  {!meta[k].length && <small>可以跳过，稍后再整理。</small>}
                  {createKind === k && (
                    <div className="inline-create">
                      <input
                        aria-label={'新建' + labels[k] + '名称'}
                        maxLength={50}
                        value={createName}
                        placeholder="输入名称"
                        onChange={(e) => setCreateName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.preventDefault();
                        }}
                      />
                      <button
                        type="button"
                        disabled={creating || !createName.trim()}
                        onClick={async () => {
                          setCreating(true);
                          try {
                            const t = await api('/taxonomy/' + k, {
                              method: 'POST',
                              body: JSON.stringify({ name: createName }),
                            });
                            patch({ [k]: [...form[k], t.id] });
                            onCreated();
                            setCreateKind(null);
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setCreating(false);
                          }
                        }}
                      >
                        创建并选中
                      </button>
                      <button type="button" onClick={() => setCreateKind(null)}>
                        取消创建
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <label>
            {isTool
              ? '个人备注 · 优缺点、经验与注意事项'
              : form.type === 'note'
                ? '笔记正文'
                : '个人笔记'}{' '}
            <small>支持格式与本地图片</small>
          </label>
          <RichEditor
            key={editorKey}
            content={form.content}
            onChange={(content) => patch({ content })}
            onError={setError}
            onBusy={setBodyUploading}
            disabled={!!resume || saving || !draftReady}
            aiBusy={aiBusy}
            onOrganize={() => noteAction.current?.()}
          />
          <AiAssist
            form={form}
            meta={meta}
            disabled={!!resume || saving || !draftReady || uploading || bodyUploading}
            onApply={(value) => {
              patch(value);
              if (value.content !== undefined) setEditorKey((n) => n + 1);
            }}
            onCreated={onCreated}
            onBusy={setAiBusy}
            registerNoteAction={registerNoteAction}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!form.pinned}
              onChange={(e) => patch({ pinned: e.target.checked ? 1 : 0 })}
            />
            置顶这个条目
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
              {false && (
                <button type="button" disabled={saving} onClick={() => save(true)}>
                  仍然保存重复网址
                </button>
              )}
            </div>
          )}
          <div className="form-footer">
            <small role="status">{draftStatus || '所有内容仅保存在本机'}</small>
            <button type="button" onClick={close}>
              取消
            </button>
            <button
              className="primary"
              disabled={saving || uploading || bodyUploading || !!resume || aiBusy}
              type="submit"
            >
              {saving ? '保存中…' : '保存条目'}
            </button>
          </div>
        </fieldset>
      </form>
    </Frame>
  );
}
