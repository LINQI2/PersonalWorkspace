import { returnReadingOrigin } from './readingNavigation';
import { ReaderToolbar, ReaderPanels } from './ReaderWorkbench';
import { ContextAssistant } from './Experience';
import { useEffect, useState } from 'react';
import { api } from './shared';
import { Dialog, Cover } from './components';
import {
  knowledgeWrite,
  type KnowledgeRecord,
  type KnowledgeSummary,
  stateLabels,
  epistemicLabels,
} from './knowledgeTypes';
import { RelatedPanel } from './RelatedPanel';
import { KnowledgeIntegration } from './KnowledgeIntegration';
import './knowledge-reading.css';
type Chapter = {
  id: string;
  parent_id: string;
  title: string;
  depth: number;
  status: keyof typeof stateLabels;
  priority: number;
  revision: number;
};
export function KnowledgeReader({
  record,
  target,
  onBack,
  onEdit,
  onInfo,
  onChanged,
  onNavigate,
  onExplore,
}: {
  record: KnowledgeRecord;
  target?: string;
  onBack: () => void;
  onEdit: (r: KnowledgeRecord) => void;
  onInfo: (id: string) => void;
  onChanged: () => void;
  onNavigate?: (id: string) => void;
  onExplore?: (id: string) => void;
}) {
  const storedArray = (key: string): string[] => {
    try {
      const a = JSON.parse(sessionStorage.getItem(key) || '[]');
      return Array.isArray(a) ? a.filter((v) => typeof v === 'string').slice(0, 100) : [];
    } catch {
      return [];
    }
  };
  const [outlineClosed, setOutlineClosed] = useState(
      () => sessionStorage.getItem('pk-outline-' + record.id) === 'closed' || innerWidth <= 760,
    ),
    [outlineFold, setOutlineFold] = useState<string[]>([]),
    [active, setActive] = useState(''),
    [manageId, setManageId] = useState(''),
    [aiScope, setAiScope] = useState(''),
    [auxOpen, setAuxOpen] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]),
    [suggestions, setSuggestions] = useState<any[]>([]),
    [bodies, setBodies] = useState<Record<string, KnowledgeRecord>>({}),
    [expanded, setExpanded] = useState<string[]>([]),
    [mode, setMode] = useState('read'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [collect, setCollect] = useState(false),
    [options, setOptions] = useState<KnowledgeSummary[]>([]),
    [q, setQ] = useState(''),
    [optionPage, setOptionPage] = useState(1),
    [optionTotal, setOptionTotal] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [integration, setIntegration] = useState(false),
    [tick, setTick] = useState(0),
    [history, setHistory] = useState<any[] | null>(null);
  const refresh = () => {
    setTick((n) => n + 1);
    onChanged();
  };
  useEffect(() => {
    setBodies({});
    setChapters([]);
    setExpanded(storedArray('pk-expanded-' + record.id));
    const savedOutline = sessionStorage.getItem('pk-outline-' + record.id);
    setOutlineClosed(savedOutline ? savedOutline === 'closed' : innerWidth <= 760);
    setOutlineFold(storedArray('pk-outline-fold-' + record.id));
    setSelected([]);
    setMode('read');
  }, [record.id]);
  useEffect(() => {
    api('/knowledge/pages/' + record.id + '/chapters')
      .then((r) => {
        setChapters(r.items);
        setSuggestions(r.suggestions);
      })
      .catch((e) => setError(e.message));
  }, [record, tick]);
  useEffect(() => {
    let live = true;
    for (const id of expanded)
      api<KnowledgeRecord>('/knowledge/records/' + id)
        .then((r) => {
          if (live) setBodies((rows) => ({ ...rows, [id]: r }));
        })
        .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [record, tick]);
  useEffect(() => {
    if (!collect) return;
    let live = true;
    api('/knowledge/records?' + new URLSearchParams({ all: '1', q, page: String(optionPage) }))
      .then((r) => {
        if (live) {
          setOptions(r.items.filter((i: KnowledgeSummary) => i.kind === 'point'));
          setOptionTotal(r.total);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [collect, q, optionPage]);
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
  const act = async (fn: () => Promise<void>) => {
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
  const show = async (id: string) => {
    setExpanded((rows) => (rows.includes(id) ? rows : [...rows, id]));
    if (!bodies[id]) {
      const r = await api<KnowledgeRecord>('/knowledge/records/' + id);
      setBodies((rows) => ({ ...rows, [id]: r }));
    }
  };
  const locate = (id: string) =>
    act(async () => {
      setActive(id);
      const ancestors: string[] = [];
      let parent = chapters.find((c) => c.id === id)?.parent_id;
      for (let n = 0; parent && n < 8; n++) {
        ancestors.push(parent);
        parent = chapters.find((c) => c.id === parent)?.parent_id;
      }
      setOutlineFold((xs) => xs.filter((x) => !ancestors.includes(x)));

      sessionStorage.setItem('pk-chapter-' + record.id, id);
      window.history.replaceState(window.history.state, '', '#chapter-' + id);
      await show(id);
      setTimeout(() => {
        const node = document.getElementById('chapter-' + id),
          root = node?.closest<HTMLElement>('.reading-main'),
          bar = node
            ?.closest('.reading-surface')
            ?.querySelector('.knowledge-reader>.reader-toolbar');
        if (node && root && bar)
          root.scrollTo({
            top:
              root.scrollTop +
              node.getBoundingClientRect().top -
              root.getBoundingClientRect().top -
              20,
            behavior: 'smooth',
          });
      }, 80);
    });
  useEffect(() => {
    const saved = target || sessionStorage.getItem('pk-chapter-' + record.id);
    if (saved && chapters.some((c) => c.id === saved)) locate(saved);
  }, [target, chapters.length]);
  useEffect(() => {
    sessionStorage.setItem('pk-expanded-' + record.id, JSON.stringify(expanded));
  }, [record.id, expanded]);
  useEffect(() => {
    sessionStorage.setItem('pk-outline-fold-' + record.id, JSON.stringify(outlineFold));
  }, [record.id, outlineFold]);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.reading-main');
    if (!root) return;
    let frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top + 30;
        let id = '';
        for (const c of chapters) {
          const r = document.getElementById('chapter-' + c.id)?.getBoundingClientRect();
          if (r && r.top <= top) id = c.id;
        }
        setActive(id);
        if (id) sessionStorage.setItem('pk-chapter-' + record.id, id);
      });
    };
    root.addEventListener('scroll', scroll);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('scroll', scroll);
    };
  }, [record.id, chapters]);
  useEffect(() => {
    const expand = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (chapters.some((c) => c.id === id)) void locate(id);
    };
    window.addEventListener('pk-expand-mark-chapter', expand);
    return () => window.removeEventListener('pk-expand-mark-chapter', expand);
  }, [chapters]);
  const evidenceRecord = active && bodies[active] ? bodies[active] : record;
  const changeParent = (c: Chapter, parent: string | null) =>
    act(async () => {
      await knowledgeWrite('/structure', 'POST', {
        items: [{ id: c.id, parent_id: parent, revision: c.revision }],
      });
      refresh();
    });
  const outline = chapters.length ? (
    <nav
      className="reader-outline"
      aria-label="章节大纲"
      hidden={outlineClosed || !chapters.length}
    >
      <strong>阅读大纲</strong>
      {record.content && (
        <button
          onClick={() => {
            sessionStorage.removeItem('pk-chapter-' + record.id);
                    window.history.replaceState(window.history.state, '', '#content-' + record.id);
            document
              .getElementById('document-body-' + record.id)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          文档正文
        </button>
      )}
      <button onClick={() => setExpanded([])}>折叠全部章节</button>
      {chapters
        .filter((c) => {
          let p = c.parent_id;
          for (let n = 0; n < 8; n++) {
            if (outlineFold.includes(p)) return false;
            const parent = chapters.find((x) => x.id === p);
            if (!parent) break;
            p = parent.parent_id;
          }
          return true;
        })
        .map((c, i) => (
          <div className="outline-node" key={c.id}>
            {chapters.some((x) => x.parent_id === c.id) && (
              <button
                aria-label={'折叠大纲 ' + c.title}
                aria-expanded={!outlineFold.includes(c.id)}
                onClick={() => setOutlineFold((xs) => toggle(xs, c.id))}
              >
                {outlineFold.includes(c.id) ? '▸' : '▾'}
              </button>
            )}
            <button
              title={c.title}
              aria-current={active === c.id ? 'location' : undefined}
              style={{ paddingLeft: 12 + c.depth * 12 }}
              onClick={() => locate(c.id)}
            >
              {i + 1}. {c.title}
            </button>
          </div>
        ))}
      {!chapters.length && <p className="muted">尚未收纳章节</p>}
    </nav>
  ) : null;
  return (
    <article className="knowledge-reader">
      <ReaderToolbar
        title={record.title}
        onBack={() => {
          onBack();
          returnReadingOrigin();
        }}
        onEdit={() => onEdit(record)}
        entry={record as any}
        onChanged={onChanged}
      >
        <div className="view-switch">
          <button aria-pressed={mode === 'read'} onClick={() => setMode('read')}>
            阅读模式
          </button>
          <button
            aria-pressed={mode === 'organize'}
            onClick={() => {
              setMode('organize');
              setManageId('');
            }}
          >
            整理模式
          </button>
        </div>
      </ReaderToolbar>
      <ReaderPanels
        outline={outline}
        outlineClosed={outlineClosed}
        onChanged={onChanged}
        onOutlineChange={(closed) => {
          setOutlineClosed(closed);
          sessionStorage.setItem('pk-outline-' + record.id, closed ? 'closed' : 'open');
        }}
        id={record.id}
        source={
          <>
            <p>用户提供的资料，来源网址未抓取验证；不代表AI推断已确认。</p>
            <p>正在查看：{evidenceRecord.title}</p>
            <p>
              {stateLabels[evidenceRecord.status]} · {epistemicLabels[evidenceRecord.epistemic]} ·
              原始日期 {evidenceRecord.original_date || '未知'}
            </p>
            {evidenceRecord.sources.map((source) => (
              <details key={source.id}>
                <summary>{source.title}</summary>
                <blockquote>{source.quote}</blockquote>
                <pre>{source.excerpt}</pre>
                {source.url && (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    来源网址（未验证）
                  </a>
                )}
              </details>
            ))}
            <button
              onClick={() =>
                act(async () => setHistory(await api('/knowledge/versions/' + record.id)))
              }
            >
              查看正文历史
            </button>
          </>
        }
        links={
          <RelatedPanel
            id={active || record.id}
            onOpen={onNavigate || onInfo}
            onChanged={onChanged}
            onExplore={onExplore}
          />
        }
        ai={
          <>
            <label>
              分析范围
              <select
                aria-label="上下文分析范围"
                value={aiScope}
                onChange={(e) => setAiScope(e.target.value)}
              >
                <option value="">当前综合文档</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <ContextAssistant
              key={aiScope || record.id}
              entry={{
                id: aiScope || record.id,
                title: chapters.find((c) => c.id === aiScope)?.title || record.title,
              }}
              onChanged={onChanged}
              onOpen={onNavigate || onInfo}
            />
          </>
        }
      >
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="eyebrow">知识页面 · {chapters.length} 个章节</div>
        <small className="reader-hint">
          {epistemicLabels[record.epistemic]} · {stateLabels[record.status]}
          （资料性质与人工确认状态）
        </small>
        <h1>{record.title}</h1>
        {record.description && <p className="reader-overview">{record.description}</p>}

        {mode === 'organize' && (
          <div className="reader-organize-bar">
            <button
              onClick={() => {
                setCollect(true);
                setSelected([]);
              }}
            >
              收纳已有知识点
            </button>
            <button
              disabled={!suggestions.length || busy}
              onClick={() => {
                if (
                  confirm(
                    '采用原导入包或显式关系中的 ' +
                      suggestions.length +
                      ' 条归属建议？不改变 ID、正文和来源。',
                  )
                )
                  act(async () => {
                    await knowledgeWrite('/structure', 'POST', {
                      items: suggestions.map((s) => ({ id: s.id, parent_id: s.parent_id })),
                    });
                    refresh();
                  });
              }}
            >
              采用显式归属建议 ({suggestions.length})
            </button>
            <button
              disabled={selected.length < 2 || selected.length > 10}
              onClick={() => setIntegration(true)}
            >
              分析选中知识 ({selected.length})
            </button>
            <button
              disabled={!selected.length || busy}
              onClick={() => {
                if (confirm('归档所选知识？正文与来源仍保留。'))
                  act(async () => {
                    for (const id of selected) {
                      const r = await api<KnowledgeRecord>('/knowledge/records/' + id);
                      await knowledgeWrite('/records/' + id, 'PUT', {
                        ...r,
                        status: 'archived',
                        references: r.references.map((v) => v.id),
                        domains: r.domains.map((v) => v.id),
                        tags: r.tags.map((v) => v.id),
                        collections: r.collections.map((v) => v.id),
                      });
                    }
                    refresh();
                  });
              }}
            >
              归档所选
            </button>
          </div>
        )}
        {!!suggestions.length && (
          <p className="reader-hint">
            有 {suggestions.length} 条显式上下级建议可在整理模式确认。相同目录不代表属于此页。
          </p>
        )}
        <div
          className={'reader-layout ' + (outlineClosed || !chapters.length ? 'outline-closed' : '')}
        >
          <div className="reader-chapters">
            {mode === 'read' && (
              <div
                id={'document-body-' + record.id}
                className="prose knowledge-prose"
                data-reading-id={record.id}
                data-reading-title={record.title}
                dangerouslySetInnerHTML={{ __html: record.content }}
              />
            )}
            {chapters.map((c, i) => (
              <section
                id={'chapter-' + c.id}
                className={
                  'reader-chapter depth-' +
                  c.depth +
                  (mode === 'organize' ? ' compact-chapter' : '')
                }
                style={{ marginLeft: Math.min(c.depth, 3) * 12 }}
                key={c.id}
              >
                <header>
                  {mode === 'organize' && (
                    <input
                      type="checkbox"
                      aria-label={'选择章节 ' + c.title}
                      checked={selected.includes(c.id)}
                      onChange={() => setSelected(toggle(selected, c.id))}
                    />
                  )}
                  <button
                    className="reader-chapter-heading"
                    aria-expanded={expanded.includes(c.id)}
                    onClick={() =>
                      act(async () => {
                        if (expanded.includes(c.id))
                          setExpanded((rows) => rows.filter((v) => v !== c.id));
                        else await show(c.id);
                      })
                    }
                  >
                    <span>{expanded.includes(c.id) ? '−' : '+'}</span>
                    <h2>
                      {i + 1}. {c.title}
                    </h2>
                  </button>
                </header>
                {mode === 'organize' && (
                  <button
                    aria-expanded={manageId === c.id}
                    onClick={() => setManageId(manageId === c.id ? '' : c.id)}
                  >
                    管理章节 · {stateLabels[c.status]}
                  </button>
                )}
                {mode === 'organize' && manageId === c.id && (
                  <div className="chapter-controls">
                    <small>
                      {stateLabels[c.status]} · P{c.priority}
                    </small>
                    {[-1, 1].map((direction) => (
                      <button
                        key={direction}
                        aria-label={(direction === -1 ? '上移章节 ' : '下移章节 ') + c.title}
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await knowledgeWrite('/records/' + c.id + '/move', 'POST', {
                              direction,
                            });
                            refresh();
                          })
                        }
                      >
                        {direction === -1 ? '↑' : '↓'}
                      </button>
                    ))}
                    <select
                      aria-label={'章节归属 ' + c.title}
                      value={c.parent_id}
                      onChange={(e) => changeParent(c, e.target.value || null)}
                    >
                      <option value={record.id}>页面直属章节</option>
                      {chapters
                        .filter((p) => p.id !== c.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      <option value="">移出页面（独立保留）</option>
                    </select>
                    <button
                      onClick={() =>
                        act(async () => onEdit(await api('/knowledge/records/' + c.id)))
                      }
                    >
                      编辑章节
                    </button>
                  </div>
                )}
                {mode === 'read' && expanded.includes(c.id) && bodies[c.id] && (
                  <>
                    <div
                      className="prose knowledge-prose"
                      data-reading-id={c.id}
                      data-reading-title={c.title}
                      dangerouslySetInnerHTML={{ __html: bodies[c.id].content }}
                    />
                    <details className="reader-metadata">
                      <summary>来源、待验证事项与状态</summary>
                      <p>
                        {stateLabels[bodies[c.id].status]} ·{' '}
                        {epistemicLabels[bodies[c.id].epistemic]} · 原始日期{' '}
                        {bodies[c.id].original_date || '未知'}
                      </p>
                      <p>{bodies[c.id].questions}</p>
                      {bodies[c.id].sources.map((s) => (
                        <details key={s.id}>
                          <summary>{s.title}</summary>
                          <blockquote>{s.quote}</blockquote>
                          <pre>{s.excerpt}</pre>
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noreferrer">
                              来源网址（未验证）
                            </a>
                          )}
                        </details>
                      ))}
                      <button onClick={() => onInfo(c.id)}>独立详情与关系</button>
                    </details>
                  </>
                )}
              </section>
            ))}
            {!chapters.length && (
              <div className="empty">
                <h2>把知识收纳为可阅读的章节</h2>
                <p>在整理模式选择已有知识点；原正文和来源保持不变。</p>
              </div>
            )}
          </div>
        </div>
        {!!record.references.length && (
          <section>
            <h3>关联资源</h3>
            <div className="knowledge-reference-grid">
              {record.references.map((r) => (
                <button key={r.id} aria-label={'查看关联 ' + r.title} onClick={() => onInfo(r.id)}>
                  <Cover entry={r} />
                  <strong>{r.title}</strong>
                  <small>{r.description}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </ReaderPanels>
      {collect && (
        <Dialog title="收纳已有知识点" wide onClose={() => setCollect(false)}>
          <div className="knowledge-import">
            <p>仅调整明确父级，保留 ID、正文、日期与来源；子章节随父级移动。</p>
            <input
              aria-label="寻找待收纳知识"
              placeholder="搜索知识点…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOptionPage(1);
              }}
            />
            <button onClick={() => setSelected(options.filter((r) => !r.page_id).map((r) => r.id))}>
              选择本页独立知识点
            </button>
            <button onClick={() => setSelected([])}>取消收纳选择</button>
            {options.map((r) => (
              <label className="collect-row" key={r.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => setSelected(toggle(selected, r.id))}
                />
                <span>
                  {r.title}
                  <small>{r.page_title ? '当前页面：' + r.page_title : '独立知识点'}</small>
                </span>
              </label>
            ))}
            <div className="pagination">
              <button disabled={optionPage <= 1} onClick={() => setOptionPage((n) => n - 1)}>
                上一页
              </button>
              <button
                disabled={optionPage * 24 >= optionTotal}
                onClick={() => setOptionPage((n) => n + 1)}
              >
                下一页
              </button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || !selected.length}
              onClick={() =>
                act(async () => {
                  await knowledgeWrite('/structure', 'POST', {
                    items: selected.map((id) => ({ id, parent_id: record.id })),
                  });
                  setCollect(false);
                  setSelected([]);
                  refresh();
                })
              }
            >
              收纳所选知识
            </button>
          </div>
        </Dialog>
      )}
      {integration && (
        <KnowledgeIntegration
          ids={selected}
          pageId={record.id}
          onClose={() => setIntegration(false)}
          onApplied={() => {
            setIntegration(false);
            refresh();
          }}
        />
      )}
      {history && (
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
                      if (confirm('将此历史正文放入编辑器？正式保存前不会改变当前正文。'))
                        onEdit({ ...record, title: v.title, content: v.content });
                    }}
                  >
                    放入编辑器
                  </button>
                </details>
              ))
            ) : (
              <p>尚无历史版本；下一次编辑保存前会保留当前正文。</p>
            )}
          </div>
        </Dialog>
      )}
    </article>
  );
}
