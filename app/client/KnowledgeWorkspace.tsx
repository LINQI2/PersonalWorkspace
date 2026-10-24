import { useEffect, useState } from 'react';
import {
  FolderPlus,
  Plus,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Upload,
  BookOpen,
  Inbox,
  Link2,
  ChevronRight,
} from 'lucide-react';
import { api, type Meta } from './shared';
import { Dialog, Cover } from './components';
import { KnowledgeEditor } from './KnowledgeEditor';
import { KnowledgeImport } from './KnowledgeImport';
import { KnowledgeReader } from './KnowledgeReader';
import {
  knowledgeWrite,
  knowledgeBlank,
  knowledgeLabels,
  stateLabels,
  epistemicLabels,
  sourceLabels,
  relationLabels,
  directoryLabel,
  type Directory,
  type KnowledgeRecord,
  type KnowledgeSummary,
  type KnowledgeForm,
} from './knowledgeTypes';
export function KnowledgeWorkspace({
  inbox,
  meta,
  revision,
  onChanged,
  onOpen,
  registerLeave,
  initialOpen,
  initialDirectory,
  onStructure,
}: {
  inbox: boolean;
  meta: Meta;
  revision: number;
  onChanged: () => void;
  onOpen: (id: string) => void;
  registerLeave: (fn: (() => Promise<boolean>) | undefined) => void;
  initialOpen?: string;
  initialDirectory?: string;
  onStructure?: () => void;
}) {
  const [dirs, setDirs] = useState<Directory[]>([]),
    [directory, setDirectory] = useState(''),
    [items, setItems] = useState<KnowledgeSummary[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('manual'),
    [showAll, setShowAll] = useState(false),
    [detail, setDetail] = useState<KnowledgeRecord | null>(null),
    [target, setTarget] = useState(''),
    [history, setHistory] = useState<any[] | null>(null),
    [editing, setEditing] = useState<{ id?: string; form: KnowledgeForm } | null>(null),
    [importOpen, setImportOpen] = useState(false),
    [folder, setFolder] = useState<{ id?: string; name: string; parent_id: string | null } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [batch, setBatch] = useState<{ raw_input: string; recorded_at: string } | null>(null),
    [localRevision, setLocalRevision] = useState(0);
  const refresh = () => {
    setLocalRevision((n) => n + 1);
    onChanged();
  };
  useEffect(() => {
    setDirectory('');
    setPage(1);
    setDetail(null);
  }, [inbox]);
  useEffect(() => {
    registerLeave(() => Promise.resolve(!editing && !importOpen));
    return () => registerLeave(undefined);
  }, [editing, importOpen]);
  useEffect(() => {
    let live = true;
    api<Directory[]>('/knowledge/directories')
      .then((d) => {
        if (live) {
          setDirs(d);
          if (directory && !d.some((v) => v.id === directory)) setDirectory('');
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [revision, localRevision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(
      () =>
        api(
          '/knowledge/records?' +
            new URLSearchParams({
              directory,
              inbox: inbox ? '1' : '',
              q: query,
              sort,
              all: showAll ? '1' : '',
              page: String(page),
            }),
        )
          .then((d) => {
            if (live) {
              setItems(d.items);
              setTotal(d.total);
              if (page > Math.max(1, Math.ceil(d.total / 24)))
                setPage(Math.max(1, Math.ceil(d.total / 24)));
            }
          })
          .catch((e) => setError(e.message))
          .finally(() => {
            if (live) setLoading(false);
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [inbox, directory, page, query, sort, showAll, revision, localRevision]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) =>
    api<KnowledgeRecord>('/knowledge/records/' + id)
      .then(async (r) => {
        if (r.page_id && r.page_id !== r.id) {
          setTarget(r.id);
          setDetail(await api('/knowledge/records/' + r.page_id));
        } else {
          setTarget('');
          setDetail(r);
        }
      })
      .catch(() => onOpen(id));
  const edit = (r: KnowledgeRecord) => {
    const form: KnowledgeForm = {
      ...r,
      url: '',
      domains: r.domains.map((d) => d.id),
      tags: r.tags.map((t) => t.id),
      collections: r.collections.map((c) => c.id),
      references: r.references.map((e) => e.id),
    };
    setEditing({ id: r.id, form });
  };
  useEffect(() => {
    if (initialOpen) open(initialOpen);
    else setDetail(null);
  }, [initialOpen]);
  useEffect(() => {
    if (initialDirectory) {
      setDirectory(initialDirectory);
      setPage(1);
      setDetail(null);
    }
  }, [initialDirectory]);
  const tree = (parent: string | null, depth = 0): React.ReactNode =>
    dirs
      .filter((d) => d.parent_id === parent)
      .map((d) => (
        <div key={d.id} className="knowledge-tree-node">
          <button
            aria-label={'目录 ' + directoryLabel(d, dirs)}
            aria-pressed={directory === d.id}
            style={{ paddingLeft: 12 + depth * 16 }}
            className={directory === d.id ? 'selected' : ''}
            onClick={() => {
              setDirectory(d.id);
              setPage(1);
              setDetail(null);
            }}
          >
            <ChevronRight size={13} />
            <span>{d.name}</span>
            <small>{d.count}</small>
          </button>
          {tree(d.id, depth + 1)}
        </div>
      ));
  return (
    <div className="knowledge-workspace">
      <div className="knowledge-hero">
        <div>
          <div className="eyebrow">CAPTURE · UNDERSTAND · ORGANIZE</div>
          <h1>
            {inbox ? '快速收集箱' : '知识目录'}
            <span className="count-badge">{total}</span>
          </h1>
          <p>先留下原始资料，再整理独立观点与来源；AI 推断和人工确认分开。</p>
        </div>
        <div className="knowledge-actions">
          {onStructure && <button onClick={onStructure}>AI 整理知识结构</button>}
          <button onClick={() => setImportOpen(true)}>
            <Upload size={16} />
            导入知识
          </button>
          <button onClick={() => setEditing({ form: knowledgeBlank('page', directory || null) })}>
            <BookOpen size={16} />
            新建混合页面
          </button>
          <button
            className="primary"
            onClick={() =>
              setEditing({ form: knowledgeBlank(inbox ? 'capture' : 'point', directory || null) })
            }
          >
            <Plus size={17} />
            {inbox ? '快速收集' : '新建知识点'}
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            onClick={() => {
              setError('');
              refresh();
            }}
          >
            重试
          </button>
        </div>
      )}
      <div className="knowledge-layout">
        <aside className="knowledge-tree">
          <div className="knowledge-tree-heading">
            <strong>知识目录树</strong>
            <button
              className="icon"
              aria-label="新建知识目录"
              onClick={() => setFolder({ name: '', parent_id: directory || null })}
            >
              <FolderPlus size={17} />
            </button>
          </div>
          <button
            className={!directory ? 'selected' : ''}
            onClick={() => {
              setDirectory('');
              setDetail(null);
              setPage(1);
            }}
          >
            <Inbox size={15} /> {inbox ? '全部收集记录' : '全部知识'}
          </button>
          {tree(null)}
          {!dirs.length && <p className="muted">先创建一个目录，也可以稍后归属。</p>}
          {directory && (
            <div className="knowledge-directory-actions">
              {([-1, 1] as const).map((direction) => (
                <button
                  key={direction}
                  className="icon"
                  aria-label={direction === -1 ? '上移当前目录' : '下移当前目录'}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await knowledgeWrite('/directories/' + directory + '/move', 'POST', {
                        direction,
                      });
                      refresh();
                    })
                  }
                >
                  {direction === -1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                </button>
              ))}
              <button
                aria-label="编辑当前目录"
                onClick={() => {
                  const d = dirs.find((d) => d.id === directory)!;
                  setFolder({ id: d.id, name: d.name, parent_id: d.parent_id });
                }}
              >
                <Pencil size={13} />
                改名/移动
              </button>
              <button
                className="danger-text"
                aria-label="删除当前目录"
                disabled={busy}
                onClick={() => {
                  if (confirm('删除此目录？非空目录会拒绝，不会删除知识。'))
                    run(async () => {
                      await knowledgeWrite('/directories/' + directory, 'DELETE', {});
                      setDirectory('');
                      refresh();
                    });
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </aside>
        <section className="knowledge-content">
          {detail?.kind === 'page' ? (
            <KnowledgeReader
              record={detail}
              target={target}
              onBack={() => setDetail(null)}
              onEdit={edit}
              onInfo={(id) =>
                api<KnowledgeRecord>('/knowledge/records/' + id)
                  .then(setDetail)
                  .catch(() => onOpen(id))
              }
              onChanged={refresh}
            />
          ) : detail ? (
            <article className="knowledge-document">
              <div className="knowledge-document-toolbar">
                <button onClick={() => setDetail(null)}>返回知识列表</button>
                <button onClick={() => edit(detail)}>
                  <Pencil size={15} />
                  编辑知识
                </button>
                <button
                  onClick={() =>
                    run(async () => setHistory(await api('/knowledge/versions/' + detail.id)))
                  }
                >
                  正文历史
                </button>
              </div>
              <div className="chips">
                <span>{knowledgeLabels[detail.kind]}</span>
                <span>{stateLabels[detail.status]}</span>
                <span>优先级 {detail.priority}</span>
                <span>{epistemicLabels[detail.epistemic]}</span>
              </div>
              <h1>{detail.title}</h1>
              <p className="muted">
                原始日期：{detail.original_date || '未知'} {detail.date_note} · 资料记录时间：
                {detail.provided_recorded_at || '未知'} · 本地记录：
                {new Date(detail.created_at).toLocaleString('zh-CN')}
              </p>
              {detail.confirmed_at ? (
                <p className="knowledge-confirmed">
                  用户确认此版本于 {new Date(detail.confirmed_at).toLocaleString('zh-CN')}
                  ；不代表网站核实了外部来源。
                </p>
              ) : (
                <p className="knowledge-candidate">尚未人工确认；来源报告和 AI 推断需要核对。</p>
              )}
              <div
                className="prose knowledge-prose"
                dangerouslySetInnerHTML={{
                  __html: detail.content || '<p>暂无正文，编辑后补充。</p>',
                }}
              />
              {detail.questions && (
                <section className="knowledge-question">
                  <h3>待验证问题</h3>
                  <p>{detail.questions}</p>
                </section>
              )}
              {!!detail.references.length && (
                <section>
                  <h3>
                    <Link2 size={17} />
                    关联资源 · {detail.references.length}
                  </h3>
                  <div className="knowledge-reference-grid">
                    {detail.references.map((r) => (
                      <button
                        key={r.id}
                        aria-label={'查看关联 ' + r.title}
                        onClick={() => onOpen(r.id)}
                      >
                        <Cover entry={r} />
                        <strong>{r.title}</strong>
                        <small>{r.description}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {detail.import_batch && (
                <button
                  onClick={() =>
                    run(async () =>
                      setBatch(
                        await knowledgeWrite('/import/source', 'POST', {
                          id: detail.import_batch!.batch_id,
                        }),
                      ),
                    )
                  }
                >
                  查看导入原文
                </button>
              )}
              <section>
                <h3>原始摘录与来源 · {detail.sources.length}</h3>
                <p className="muted">来源网址和日期来自用户提供资料，未抓取或验证。</p>
                {detail.sources.map((s, i) => (
                  <details className="knowledge-source-box" key={s.id}>
                    <summary>
                      {i + 1}. {sourceLabels[s.kind]} · {s.title} · {s.original_date || '日期未知'}
                    </summary>
                    <p>
                      {s.date_note} · 资料记录时间：{s.provided_recorded_at || '未知'} · 本地记录：
                      {s.recorded_at ? new Date(s.recorded_at).toLocaleString('zh-CN') : ''}
                    </p>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        用户提供的来源网址
                      </a>
                    )}
                    {s.quote && <blockquote>{s.quote}</blockquote>}
                    <pre>{s.excerpt}</pre>
                    {s.batch_id && (
                      <button
                        onClick={() =>
                          run(async () =>
                            setBatch(
                              await knowledgeWrite('/import/source', 'POST', { id: s.batch_id }),
                            ),
                          )
                        }
                      >
                        查看完整导入原文
                      </button>
                    )}
                  </details>
                ))}
                {!detail.sources.length && (
                  <p className="muted">尚无来源摘录，可编辑补充；不虚构引用。</p>
                )}
              </section>
              {!!detail.relations.length && (
                <section>
                  <h3>关系与观点变化</h3>
                  {detail.relations.map((r) => (
                    <div className="knowledge-relation" key={r.id}>
                      <p>
                        {r.from_title} → {r.to_title}
                      </p>
                      <small>
                        {relationLabels[r.kind]} ·{' '}
                        {r.state === 'candidate' ? '候选，未确认' : '用户已确认'} · {r.note}
                      </small>
                      <button
                        onClick={() => (r.from_id === detail.id ? open(r.to_id) : open(r.from_id))}
                      >
                        查看关联知识
                      </button>
                      {r.state === 'candidate' && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (confirm('确认这条关系？不会合并或删除原文。'))
                              run(async () => {
                                await knowledgeWrite('/relations/' + r.id + '/review', 'POST', {
                                  action: 'confirm',
                                  confirm: '确认关系',
                                });
                                await open(detail.id);
                                refresh();
                              });
                          }}
                        >
                          确认关系
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (confirm('拒绝/移除此关系？两条原知识保留。'))
                            run(async () => {
                              await knowledgeWrite('/relations/' + r.id + '/review', 'POST', {
                                action: 'reject',
                              });
                              await open(detail.id);
                              refresh();
                            });
                        }}
                      >
                        移除关系
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <div className="chips">
                {detail.collections.map((c) => (
                  <span key={c.id}>专题：{c.name}</span>
                ))}
              </div>
              <div className="detail-bottom">
                <small>稳定 ID：{detail.id}</small>
                <button
                  className="danger-text"
                  onClick={() => {
                    if (
                      confirm(
                        '移入回收站？ID、正文、来源和关联保留；有明确引用时会拒绝。',
                      )
                    )
                      run(async () => {
                        await api('/entries/' + detail.id, { method: 'DELETE' });
                        setDetail(null);
                        refresh();
                      });
                  }}
                >
                  删除知识记录
                </button>
              </div>
            </article>
          ) : (
            <>
              <div className="knowledge-filterbar">
                {!inbox && (
                  <button
                    aria-pressed={showAll}
                    onClick={() => {
                      setShowAll(!showAll);
                      setPage(1);
                    }}
                  >
                    {showAll ? '恢复页面优先' : '查看所有知识点'}
                  </button>
                )}
                <input
                  aria-label="搜索知识"
                  placeholder="搜索标题、正文或待验证问题…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
                <select
                  aria-label="知识排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="manual">手动顺序</option>
                  <option value="priority">优先级</option>
                  <option value="recent">最近更新</option>
                </select>
              </div>
              {loading ? (
                <p className="muted">正在读取知识…</p>
              ) : items.length ? (
                <div className="knowledge-list">
                  {items.map((r) => (
                    <article className="knowledge-row" key={r.id}>
                      <button
                        className="knowledge-row-main"
                        aria-label={'阅读知识 ' + r.title}
                        onClick={() => open(r.id)}
                      >
                        <div className="chips">
                          <span>{knowledgeLabels[r.kind]}</span>
                        </div>
                        <h3>{r.title}</h3>
                        <p>{r.description || r.questions || '打开查看正文、来源与观点关系。'}</p>
                        <small>
                          {r.page_title && r.page_id !== r.id
                            ? '所属页面：' + r.page_title
                            : r.source_count + ' 份来源 · ' + r.reference_count + ' 条关联'}
                        </small>
                      </button>
                      <div className="knowledge-row-actions">
                        <button
                          className="icon"
                          disabled={busy || sort !== 'manual'}
                          aria-label={'上移知识 ' + r.title}
                          onClick={() =>
                            run(async () => {
                              await knowledgeWrite('/records/' + r.id + '/move', 'POST', {
                                direction: -1,
                              });
                              refresh();
                            })
                          }
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="icon"
                          disabled={busy || sort !== 'manual'}
                          aria-label={'下移知识 ' + r.title}
                          onClick={() =>
                            run(async () => {
                              await knowledgeWrite('/records/' + r.id + '/move', 'POST', {
                                direction: 1,
                              });
                              refresh();
                            })
                          }
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="icon"
                          aria-label={'编辑知识 ' + r.title}
                          onClick={() =>
                            api<KnowledgeRecord>('/knowledge/records/' + r.id)
                              .then(edit)
                              .catch((e) => setError(e.message))
                          }
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <BookOpen size={30} />
                  <h2>{inbox ? '先留下今天值得保存的资料' : '从一条知识或一个目录开始'}</h2>
                  <p>手动收集或导入 ChatGPT 整理结果；正式写入始终由你确认。</p>
                  <button onClick={() => setImportOpen(true)}>导入知识</button>
                </div>
              )}
              <div className="pagination">
                <span>
                  共 {total} 条 · 第 {page} 页
                </span>
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <button disabled={page * 24 >= total} onClick={() => setPage(page + 1)}>
                  下一页
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      {editing && (
        <KnowledgeEditor
          id={editing.id}
          initial={editing.form}
          dirs={dirs}
          meta={meta}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            refresh();
            open(id);
          }}
        />
      )}
      {importOpen && (
        <KnowledgeImport
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            setDetail(null);
            setDirectory('');
            setPage(1);
            refresh();
          }}
        />
      )}
      {folder && (
        <Dialog
          title="管理知识目录"
          onClose={() => {
            if (!busy) setFolder(null);
          }}
        >
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await knowledgeWrite(
                  '/directories' + (folder.id ? '/' + folder.id : ''),
                  folder.id ? 'PUT' : 'POST',
                  folder,
                );
                setFolder(null);
                refresh();
              });
            }}
          >
            <label>
              目录名称
              <input
                aria-label="目录名称"
                required
                maxLength={50}
                value={folder.name}
                onChange={(e) => setFolder({ ...folder, name: e.target.value })}
              />
            </label>
            <label>
              父目录
              <select
                aria-label="父目录"
                value={folder.parent_id || ''}
                onChange={(e) => setFolder({ ...folder, parent_id: e.target.value || null })}
              >
                <option value="">根目录</option>
                {dirs
                  .filter((d) => d.id !== folder.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {directoryLabel(d, dirs)}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">最多 8 层；循环与非空删除会安全拒绝。</p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              保存目录
            </button>
          </form>
        </Dialog>
      )}
      {batch && (
        <Dialog title="导入来源原文" wide onClose={() => setBatch(null)}>
          <div className="knowledge-import">
            <p>
              本地导入时间：{new Date(batch.recorded_at).toLocaleString('zh-CN')} ·
              不等于观点形成日期
            </p>
            <pre>{batch.raw_input}</pre>
          </div>
        </Dialog>
      )}
      {history && detail && (
        <Dialog title="知识正文历史" wide onClose={() => setHistory(null)}>
          <div className="knowledge-import">
            {history.length ? (
              history.map((v) => (
                <details key={v.id}>
                  <summary>
                    {v.title} · 版本 {v.revision} · {v.created_at}
                  </summary>
                  <div className="prose" dangerouslySetInnerHTML={{ __html: v.content }} />
                  <button
                    onClick={() => {
                      if (confirm('将此历史正文放入编辑器？保存前不会修改正式正文。')) {
                        setHistory(null);
                        edit({ ...detail, title: v.title, content: v.content });
                      }
                    }}
                  >
                    放入编辑器
                  </button>
                </details>
              ))
            ) : (
              <p>尚无历史版本；下一次编辑保存会保留当前正文。</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
