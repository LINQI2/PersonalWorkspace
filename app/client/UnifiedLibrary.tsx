import { ReaderPanels } from './ReaderWorkbench';
import { RelatedPanel } from './RelatedPanel';
import { ContentPreview } from './ContentPreview';
import { ContentActions, ReadingSurface, contentKind, ContextAssistant } from './Experience';
import { useEffect, useState, useRef } from 'react';
import { api, type Entry, type Meta, type Form, blank, toolLabels } from './shared';
import { Dialog, Cover } from './components';
import { DomainTree, domainOutline } from './DomainTree';
import { FilterMenu } from './FilterMenu';
import { KnowledgeExplorer } from './KnowledgeExplorer';
import { KnowledgeReader } from './KnowledgeReader';
import { KnowledgeEditor } from './KnowledgeEditor';
import { UnifiedImport, contentLabels } from './UnifiedImport';
import {
  knowledgeWrite,
  epistemicLabels,
  stateLabels,
  knowledgeBlank,
  type KnowledgeRecord,
  type KnowledgeForm,
} from './knowledgeTypes';
export async function libraryWrite(url: string, method: string, body: any = {}) {
  const s = await api('/local/session');
  return api('/library' + url, {
    method,
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify(body),
  });
}
type Domain = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  count: number;
};
export function UnifiedLibrary({
  meta,
  revision,
  scope,
  onEditEntry,
  inbox = false,
  initialOpen = '',
  onChanged,
  onOpen,
  onCreate,
  onStructure,
  onTopic,
  registerLeave,
}: {
  scope?: { domain: string; topic: string; query: string; nonce: number; tag?: string };
  onEditEntry?: (e: Entry) => void;
  meta: Meta;
  revision: number;
  inbox?: boolean;
  initialOpen?: string;
  onChanged: () => void;
  onOpen: (id: string) => void;
  onCreate: (form: Form) => void;
  onStructure: () => void;
  onTopic: (id: string) => void;
  registerLeave: (fn: (() => Promise<boolean>) | undefined) => void;
}) {
  const [legacyDirs, setLegacyDirs] = useState<any[]>([]),
    [domains, setDomains] = useState<Domain[]>([]),
    [folded, setFolded] = useState<string[]>([]),
    [domain, setDomain] = useState(() => sessionStorage.getItem('pk-library-domain') || ''),
    [tag, setTag] = useState(() => sessionStorage.getItem('pk-library-tag') || ''),
    [topic, setTopic] = useState(() => sessionStorage.getItem('pk-library-topic') || ''),
    [type, setType] = useState(() => sessionStorage.getItem('pk-library-type') || ''),
    [query, setQuery] = useState(() => sessionStorage.getItem('pk-library-query') || ''),
    [sort, setSort] = useState(() => sessionStorage.getItem('pk-library-sort') || 'updated'),
    [page, setPage] = useState(() => Number(sessionStorage.getItem('pk-library-page')) || 1),
    [items, setItems] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [document, setDocument] = useState<KnowledgeRecord | null>(null),
    [target, setTarget] = useState(''),
    [info, setInfo] = useState<KnowledgeRecord | null>(null),
    [editing, setEditing] = useState<{ id?: string; form: KnowledgeForm } | null>(null),
    [manage, setManage] = useState(false),
    [treeForm, setTreeForm] = useState({ id: '', name: '', parent_id: '', position: 0 }),
    [views, setViews] = useState<any[]>([]),
    [viewFilter, setViewFilter] = useState<any>(null),
    [ruleOpen, setRuleOpen] = useState(false),
    [rule, setRule] = useState<any>({ domains: [], tags: [], types: [] }),
    [ruleMembers, setRuleMembers] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [rawSource, setRawSource] = useState('');
  const [sourceFilter, setSourceFilter] = useState(
      () => sessionStorage.getItem('pk-library-source') || '',
    ),
    [openFilter, setOpenFilter] = useState(''),
    [stateFilter, setStateFilter] = useState(
      () => sessionStorage.getItem('pk-library-state') || '',
    ),
    [batchMode, setBatchMode] = useState(false),
    [preview, setPreview] = useState<Entry | null>(null);
  useEffect(() => {
    for (const [k, v] of Object.entries({ domain, tag, topic, type, query, sort }))
      sessionStorage.setItem('pk-library-' + k, v);
  }, [domain, tag, topic, type, query, sort]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pk-library-scope', { detail: { domain, topic, query, tag } }),
    );
  }, [domain, topic, query, tag]);
  useEffect(() => {
    sessionStorage.setItem('pk-library-page', String(page));
  }, [page]);
  const pendingScroll = useRef<number | null>(
    Number(sessionStorage.getItem('pk-library-scroll')) || 0,
  );
  useEffect(() => {
    if (!loading && items.length && pendingScroll.current !== null) {
      const y = pendingScroll.current;
      pendingScroll.current = null;
      const frame = requestAnimationFrame(() => window.scrollTo(0, y));
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, items]);
  useEffect(() => {
    const remember = () => sessionStorage.setItem('pk-library-scroll', String(window.scrollY));
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, []);
  useEffect(() => {
    const close = () => {
      setDocument(null);
      setInfo(null);
      setPreview(null);
      setEditing(null);
    };
    window.addEventListener('pk-history-close', close);
    return () => window.removeEventListener('pk-history-close', close);
  }, []);
  const [explore, setExplore] = useState<string | null>(null);
  const [toolKind, setToolKind] = useState(''),
    [layout, setLayout] = useState(() => localStorage.getItem('pk-library-layout') || 'list');
  useEffect(() => {
    sessionStorage.setItem('pk-library-source', sourceFilter);
    sessionStorage.setItem('pk-library-state', stateFilter);
  }, [sourceFilter, stateFilter]);
  const originalDomain = domains.find((d) => d.id === treeForm.id);
  const treeDirty = treeForm.id
    ? !!originalDomain &&
      (treeForm.name !== originalDomain.name ||
        treeForm.parent_id !== (originalDomain.parent_id || '') ||
        treeForm.position !== originalDomain.position)
    : !!treeForm.name.trim() || !!treeForm.parent_id;
  useEffect(() => {
    api('/preferences')
      .then((p) => {
        setSort(p.sort);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!scope) return;
    if (sessionStorage.getItem('pk-library-intent') !== String(scope.nonce)) {
      setPage(1);
      pendingScroll.current = 0;
      setSourceFilter('');
      setStateFilter('');
      sessionStorage.setItem('pk-library-intent', String(scope.nonce));
    }
    setDomain(scope.domain);
    setTopic(scope.topic);
    setQuery(scope.query);
    setTag(scope.tag || '');
    setViewFilter(null);
    if (scope.nonce < 0) setEditing({ form: knowledgeBlank('page') });
  }, [scope?.nonce]);
  useEffect(() => {
    const close = () => {
      if (!editing) {
        setDocument(null);
        setInfo(null);
      }
    };
    window.addEventListener('pk-close-readers', close);
    return () => window.removeEventListener('pk-close-readers', close);
  }, [editing]);
  useEffect(() => {
    registerLeave(() => Promise.resolve(!editing && !importOpen && !manage && !ruleOpen));
    return () => registerLeave(undefined);
  }, [editing, importOpen, manage, ruleOpen]);
  useEffect(() => {
    let live = true;
    Promise.all([api('/library/domains'), api('/library/views'), api('/knowledge/directories')])
      .then(([d, v, old]) => {
        if (live) {
          setDomains(d);
          setViews(v);
          setLegacyDirs(old);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [revision]);
  const filterSignature = JSON.stringify([
    domain,
    tag,
    topic,
    type,
    query,
    sort,
    viewFilter,
    sourceFilter,
    stateFilter,
  ]);
  const previousFilters = useRef(filterSignature);
  useEffect(() => {
    if (previousFilters.current !== filterSignature) setPage(1);
    previousFilters.current = filterSignature;
    setSelected([]);
  }, [domain, tag, topic, type, query, sort, viewFilter, sourceFilter, stateFilter]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        api(
          '/entries?' +
            new URLSearchParams({
              library: '1',
              q: query,
              source: sourceFilter,
              status: stateFilter,
              view: inbox ? 'inbox' : 'all',
              content_type: type,
              tool_kind: type === 'tool' ? toolKind : '',
              domains: domain,
              tags: tag,
              collections: topic,
              sort,
              page: String(page),
              ...(viewFilter ? { saved_view: JSON.stringify(viewFilter) } : {}),
            }),
        )
          .then((r) => {
            if (live) {
              setItems(r.items);
              setTotal(r.total);
            }
          })
          .catch((e) => live && setError(e.message))
          .finally(() => live && setLoading(false)),
      180,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    revision,
    page,
    query,
    domain,
    tag,
    topic,
    type,
    sort,
    inbox,
    viewFilter,
    toolKind,
    sourceFilter,
    stateFilter,
  ]);
  const previousTool = useRef(toolKind);
  useEffect(() => {
    if (previousTool.current !== toolKind) setPage(1);
    previousTool.current = toolKind;
  }, [toolKind]);
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
  const open = async (id: string) => {
    sessionStorage.setItem('pk-library-scroll', String(window.scrollY));
    sessionStorage.setItem('pk-last-read', id);
    if (location.hash !== '#content-' + id)
      history.pushState({ pkReader: true }, '', '#content-' + id);
    const requestedHash = location.hash;
    const e = await api<Entry>('/entries/' + id);
    if (location.hash !== requestedHash) return;
    if (!e.knowledge_kind) {
      setDocument(null);
      setInfo(null);
      onOpen(id);
      return;
    }
    const r = await api<KnowledgeRecord>('/knowledge/records/' + id);
    if (location.hash !== requestedHash) return;
    if (r.page_id || r.kind === 'page') {
      setTarget(r.page_id && r.page_id !== id ? id : '');
      setDocument(r.page_id && r.page_id !== id ? await api('/knowledge/records/' + r.page_id) : r);
    } else setInfo(r);
  };
  useEffect(() => {
    if (initialOpen) open(initialOpen).catch((e) => setError(e.message));
  }, [initialOpen]);
  const browse = async (e: Entry) => {
    if (e.mindmap) {
      onOpen(e.id);
      return;
    }
    if (!e.knowledge_kind) {
      setPreview(e);
      return;
    }
    if (e.knowledge_kind === 'page') {
      await open(e.id);
      return;
    }
    const r = await api<KnowledgeRecord>('/knowledge/records/' + e.id);
    if (r.page_id) await open(e.id);
    else setPreview(e);
  };
  const edit = (r: KnowledgeRecord) =>
    setEditing({
      id: r.id,
      form: {
        ...r,
        url: '',
        domains: r.domains.map((d) => d.id),
        tags: r.tags.map((t) => t.id),
        collections: r.collections.map((c) => c.id),
        references: r.references.map((e) => e.id),
      },
    });
  const tree = (parent: string | null, depth = 0): React.ReactNode =>
    domains
      .filter((d) => (d.parent_id || null) === parent)
      .map((d) => (
        <div key={d.id}>
          <div
            className={'domain-tree-row ' + (domain === d.id ? 'selected' : '')}
            style={{ paddingLeft: depth * 14 }}
          >
            <button
              aria-label={'折叠领域 ' + d.name}
              aria-expanded={!folded.includes(d.id)}
              onClick={() =>
                setFolded((xs) =>
                  xs.includes(d.id) ? xs.filter((x) => x !== d.id) : [...xs, d.id],
                )
              }
            >
              {domains.some((x) => x.parent_id === d.id)
                ? folded.includes(d.id)
                  ? '▸'
                  : '▾'
                : '·'}
            </button>
            <button
              aria-label={'浏览领域 ' + d.name}
              onClick={() => {
                setDomain(d.id);
                setViewFilter(null);
              }}
            >
              {d.name}
              <small>{d.count}</small>
            </button>
          </div>
          {!folded.includes(d.id) && tree(d.id, depth + 1)}
        </div>
      ));
  return (
    <div className="unified-library">
      <div className="knowledge-hero">
        <div>
          <div className="eyebrow">CONTENT · SOURCES · UNDERSTANDING</div>
          <h1>
            {inbox ? '收集箱' : '知识库'} <span className="count-badge">{total}</span>
          </h1>
          <p>用领域组织内容，用文档沉淀观点。章节保留在文档内部，来源可追溯。</p>
        </div>
        <div className="knowledge-actions">
          <button onClick={() => setExplore('')}>知识探索</button>
          <details
            className="library-management"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                e.currentTarget.open = false;
              }
            }}
          >
            <summary>管理与导入</summary>
            <div>
              <button onClick={() => setManage(true)}>管理领域树</button>
              <button
                aria-pressed={batchMode}
                onClick={() => {
                  setBatchMode(!batchMode);
                  setSelected([]);
                }}
              >
                多选管理
              </button>
              <button onClick={onStructure}>AI整理知识结构</button>
              <button onClick={() => setImportOpen(true)}>统一导入</button>
            </div>
          </details>
          <button
            className="primary"
            onClick={() =>
              inbox
                ? setEditing({ form: knowledgeBlank('capture') })
                : type === 'document'
                  ? setEditing({ form: knowledgeBlank('page') })
                  : onCreate({
                      ...blank(),
                      type: type === 'bookmark' ? 'bookmark' : 'note',
                      ...(type === 'tool' ? { resource_kind: 'tool', tool_kind: 'other' } : {}),
                      domains: domain && domain !== '__unassigned__' ? [domain] : [],
                      primary_domain_id: domain !== '__unassigned__' ? domain || null : null,
                    })
            }
          >
            {type === 'document' ? '新建综合文档' : inbox ? '收集原文' : '添加内容'}
          </button>
        </div>
      </div>
      <div className="type-tabs library-types">
        {[
          ['', '全部'],
          ['mindmap', '思维导图'],
          ['note', '笔记'],
          ['bookmark', '网站收藏'],
          ['tool', '工具'],
          ['document', '综合文档'],
        ].map(([k, v]) => (
          <button
            key={k}
            className={type === k ? 'selected' : ''}
            onClick={() => {
              setType(k);
              setViewFilter(null);
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="library-body">
        <aside className="library-classification">
          <div className="nav-label">
            领域树{' '}
            <button onClick={() => setManage(true)} aria-label="管理领域树">
              ＋
            </button>
          </div>
          <button
            onClick={() => {
              setDomain('');
              setViewFilter(null);
            }}
            className={!domain ? 'selected' : ''}
          >
            全部领域
          </button>
          <button
            className={domain === '__unassigned__' ? 'selected' : ''}
            onClick={() => {
              setDomain('__unassigned__');
              setViewFilter(null);
            }}
          >
            未归属领域
          </button>
          {tree(null)}
          {!domains.length && <p className="muted">从一个领域开始，再按需要创建子领域。</p>}
          <details className="legacy-views">
            <summary>旧版已保存筛选</summary>
            {views.map((v) => (
              <div className="saved-view" key={v.id}>
                <button
                  onClick={() => {
                    setViewFilter(v.filters);
                    setDomain('');
                    setTag('');
                    setType('');
                    setTopic('');
                  }}
                >
                  {v.name}
                </button>
                <button
                  aria-label={'取消固定 ' + v.name}
                  onClick={() =>
                    run(async () => {
                      await libraryWrite('/views/' + v.id, 'DELETE');
                      onChanged();
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </details>
        </aside>
        <section className="library-results">
          <div className="library-filterbar">
            <input
              aria-label="统一搜索"
              placeholder="搜索所有内容和文档章节…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {[
              {
                key: 'topic',
                label: '专题',
                value: topic,
                options: meta.collections,
                change: (v: string) => {
                  setTopic(v);
                  setViewFilter(null);
                },
              },
              {
                key: 'tag',
                label: '标签',
                value: tag,
                options: meta.tags,
                change: (v: string) => {
                  setTag(v);
                  setViewFilter(null);
                },
              },
              {
                key: 'source',
                label: '来源',
                value: sourceFilter,
                options: [
                  ['chatgpt', 'ChatGPT'],
                  ['report', '周报 / 报告'],
                  ['inspiration', '个人灵感'],
                  ['website', '网站'],
                  ['other', '其他来源'],
                ].map(([id, name]) => ({ id, name })),
                change: setSourceFilter,
              },
              {
                key: 'state',
                label: '状态',
                value: stateFilter,
                options: [
                  ['inbox', '待处理'],
                  ['later', '稍后'],
                  ['done', '已处理'],
                  ['review', '待验证'],
                  ['confirmed', '已确认'],
                  ['archived', '已归档'],
                ].map(([id, name]) => ({ id, name })),
                change: setStateFilter,
              },
            ].map((f) => (
              <FilterMenu
                key={f.key}
                label={f.label}
                value={f.value}
                options={f.options}
                open={openFilter === f.key}
                onOpen={(v) => setOpenFilter(v ? f.key : '')}
                onChange={f.change}
              />
            ))}
            <select
              aria-label="内容排序"
              value={sort}
              onChange={(e) => {
                const value = e.target.value;
                run(async () => {
                  const p = await api('/preferences', {
                    method: 'PUT',
                    body: JSON.stringify({ sort: value }),
                  });
                  setSort(p.sort);
                });
              }}
            >
              <option value="updated">最近编辑</option>
              <option value="recent">最近添加</option>
              <option value="title">标题</option>
              <option value="pinned">置顶</option>
            </select>
            {type === 'tool' && (
              <select
                aria-label="工具类型筛选"
                value={toolKind}
                onChange={(e) => setToolKind(e.target.value)}
              >
                <option value="">全部工具类型</option>
                {Object.entries(toolLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <div className="view-toggle" aria-label="知识库浏览方式">
              {[
                ['grid', '网格'],
                ['list', '列表'],
              ].map(([k, v]) => (
                <button
                  key={k}
                  aria-pressed={layout === k}
                  onClick={() =>
                    run(async () => {
                      const p = await api('/preferences', {
                        method: 'PUT',
                        body: JSON.stringify({ layout: k }),
                      });
                      setLayout(p.layout);
                      localStorage.setItem('pk-library-layout', p.layout);
                    })
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {(domain || topic || tag || type || sourceFilter || stateFilter || query) && (
            <div className="active-filters">
              <span>当前筛选：</span>
              {[
                [
                  domain,
                  domains.find((d) => d.id === domain)?.name || '未归属领域',
                  () => setDomain(''),
                ],
                [topic, meta.collections.find((c) => c.id === topic)?.name, () => setTopic('')],
                [tag, meta.tags.find((t) => t.id === tag)?.name, () => setTag('')],
                [type, contentLabels[type] || type, () => setType('')],
                [
                  sourceFilter,
                  (
                    {
                      chatgpt: 'ChatGPT',
                      report: '周报 / 报告',
                      inspiration: '个人灵感',
                      website: '网站',
                      other: '其他来源',
                    } as Record<string, string>
                  )[sourceFilter],
                  () => setSourceFilter(''),
                ],
                [
                  stateFilter,
                  (
                    {
                      inbox: '待处理',
                      later: '稍后',
                      done: '已处理',
                      review: '待验证',
                      confirmed: '已确认',
                      archived: '已归档',
                    } as Record<string, string>
                  )[stateFilter],
                  () => setStateFilter(''),
                ],
                [query, query, () => setQuery('')],
              ].map(([value, label, clear], i) =>
                value ? (
                  <button key={i} onClick={clear as () => void}>
                    {String(label)} ×
                  </button>
                ) : null,
              )}
              <button
                onClick={() => {
                  setDomain('');
                  setTopic('');
                  setTag('');
                  setType('');
                  setSourceFilter('');
                  setStateFilter('');
                  setQuery('');
                  setViewFilter(null);
                }}
              >
                重置全部筛选
              </button>
            </div>
          )}
          {!!views.length && (
            <details className="legacy-views">
              <summary>已保存筛选（兼容）</summary>
              {views.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setViewFilter(v.filters);
                    setDomain('');
                    setTopic('');
                    setTag('');
                    setType('');
                  }}
                >
                  {v.name}
                </button>
              ))}
            </details>
          )}
          {viewFilter && (
            <p className="muted">
              正在使用已保存的组合筛选 <button onClick={() => setViewFilter(null)}>清除</button>
            </p>
          )}
          {topic && (
            <div className="knowledge-actions">
              <button onClick={() => onTopic(topic)}>打开专题总结</button>
              <button
                onClick={() =>
                  run(async () => {
                    const r = await api('/library/collections/' + topic + '/rules');
                    setRule(r.rules || { domains: [], tags: [], types: [] });
                    setRuleMembers(r);
                    setRuleOpen(true);
                  })
                }
              >
                专题动态筛选规则
              </button>
            </div>
          )}
          {!!selected.length && (
            <div className="draft-banner">
              已选{selected.length}条{' '}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api('/batch', {
                      method: 'POST',
                      body: JSON.stringify({ ids: selected, action: 'pin' }),
                    });
                    setSelected([]);
                    onChanged();
                  })
                }
              >
                置顶所选
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api('/batch', {
                      method: 'POST',
                      body: JSON.stringify({ ids: selected, action: 'unpin' }),
                    });
                    setSelected([]);
                    onChanged();
                  })
                }
              >
                取消置顶所选
              </button>
              <button onClick={() => setSelected([])}>取消选择</button>
            </div>
          )}
          {loading ? (
            <p className="muted">正在检索本地内容…</p>
          ) : items.length ? (
            <div className={'unified-cards ' + (layout === 'list' ? 'unified-list' : '')}>
              {items.map((e) => {
                const kind = e.mindmap
                  ? 'mindmap'
                  : e.resource_kind === 'tool'
                    ? 'tool'
                    : e.knowledge_kind === 'page'
                      ? 'document'
                      : e.type === 'bookmark'
                        ? 'bookmark'
                        : 'note';
                return (
                  <article className={'unified-card unified-' + kind} key={e.id}>
                    <div className="unified-card-top">
                      {!!e.pinned && <small>已置顶</small>}
                      <span>
                        {contentLabels[kind]}
                        {e.knowledge_kind === 'point' ? ' · 知识块' : ''}
                      </span>
                      {batchMode && (
                        <input
                          aria-label={'选择内容 ' + e.title}
                          type="checkbox"
                          checked={selected.includes(e.id)}
                          onChange={() =>
                            setSelected((xs) =>
                              xs.includes(e.id) ? xs.filter((x) => x !== e.id) : [...xs, e.id],
                            )
                          }
                        />
                      )}
                    </div>
                    <button
                      className="unified-card-main"
                      aria-label={'阅读内容 ' + e.title}
                      onClick={() => browse(e).catch((e) => setError(e.message))}
                    >
                      {['tool', 'bookmark'].includes(kind) && <Cover entry={e} />}
                      <h3>{e.title}</h3>
                      <p>{e.description || e.plain_text?.slice(0, 160) || ''}</p>
                    </button>
                    <div className="chips">
                      {e.domains.slice(0, 3).map((d) => (
                        <span key={d.id}>
                          {e.primary_domain_id === d.id ? '主 · ' : ''}
                          {d.name}
                        </span>
                      ))}
                    </div>
                    {kind === 'tool' && (
                      <details>
                        <summary>个人备注</summary>
                        <div className="prose" dangerouslySetInnerHTML={{ __html: e.content }} />
                      </details>
                    )}
                    <ContentActions
                      entry={e}
                      onChanged={onChanged}
                      onEdit={() =>
                        e.knowledge_kind
                          ? api<KnowledgeRecord>('/knowledge/records/' + e.id).then(edit)
                          : e.mindmap
                            ? onOpen(e.id)
                            : onEditEntry?.(e)
                      }
                      onPreview={e.mindmap ? undefined : () => setPreview(e)}
                    />
                    <footer>
                      <small>{new Date(e.updated_at).toLocaleDateString('zh-CN')}</small>
                      {e.url && (
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          访问来源 ↗
                        </a>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <h3>
                {domain || topic || tag || query || type || sourceFilter || stateFilter
                  ? '没有匹配的内容'
                  : '这里还没有内容'}
              </h3>
              <p>添加笔记、收藏或工具，也可以导入整理好的综合文档。</p>
            </div>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
              上一页
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(total / 24))}
            </span>
            <button disabled={page * 24 >= total} onClick={() => setPage((n) => n + 1)}>
              下一页
            </button>
          </div>
        </section>
      </div>
      {preview && (
        <ContentPreview
          entry={preview}
          onClose={() => setPreview(null)}
          onRead={() => {
            const id = preview.id;
            setPreview(null);
            open(id);
          }}
          onChanged={() => {
            onChanged();
            api<Entry>('/entries/' + preview.id).then(setPreview);
          }}
          onEdit={() => {
            const e = preview;
            setPreview(null);
            e.knowledge_kind
              ? api<KnowledgeRecord>('/knowledge/records/' + e.id).then(edit)
              : onEditEntry?.(e);
          }}
          onOpen={(id) => {
            setPreview(null);
            open(id);
          }}
        />
      )}
      {explore !== null && (
        <KnowledgeExplorer
          initial={explore}
          onClose={() => setExplore(null)}
          onOpen={(id) => {
            setExplore(null);
            open(id);
          }}
        />
      )}
      {importOpen && (
        <UnifiedImport
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            onChanged();
          }}
        />
      )}
      {document && (
        <ReadingSurface
          title="综合文档阅读"
          onClose={() => {
            if (!editing) {
              setDocument(null);
              history.replaceState(null, '', location.pathname + location.search);
            }
          }}
        >
          <KnowledgeReader
            record={document}
            target={target}
            onBack={() => {
              setDocument(null);
              history.replaceState(null, '', location.pathname + location.search);
            }}
            onEdit={edit}
            onNavigate={(id) => {
              setDocument(null);
              open(id);
            }}
            onExplore={(id) => setExplore(id)}
            onInfo={(id) =>
              api<KnowledgeRecord>('/knowledge/records/' + id)
                .then(setInfo)
                .catch((e) => setError(e.message))
            }
            onChanged={() => {
              onChanged();
              api<KnowledgeRecord>('/knowledge/records/' + document.id).then(setDocument);
            }}
          />
        </ReadingSurface>
      )}
      {info && (
        <ReadingSurface
          title={info.title}
          entry={info as unknown as Entry}
          onEdit={() => edit(info)}
          onChanged={() => {
            onChanged();
            api<KnowledgeRecord>('/knowledge/records/' + info.id).then(setInfo);
          }}
          onClose={() => {
            setInfo(null);
            history.replaceState(null, '', location.pathname + location.search);
          }}
        >
          <ReaderPanels
            id={info.id}
            onChanged={onChanged}
            source={
              <>
                {' '}
                <details>
                  <summary>来源、状态与实际日期</summary>
                  <p>
                    {epistemicLabels[info.epistemic]} / {stateLabels[info.status]} · 原始日期{' '}
                    {info.original_date || '未知'}
                  </p>
                  {info.sources.map((s) => (
                    <details key={s.id}>
                      <summary>
                        {s.title} · {s.original_date || '日期未知'}
                      </summary>
                      <pre>{s.excerpt}</pre>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          来源网址
                        </a>
                      )}
                    </details>
                  ))}
                  {info.import_batch && (
                    <button
                      onClick={() =>
                        run(async () => {
                          const b = await knowledgeWrite('/import/source', 'POST', {
                            id: info.import_batch!.batch_id,
                          });
                          setError('');
                          setRawSource(b.raw_input);
                        })
                      }
                    >
                      查看原始导入包
                    </button>
                  )}
                  {info.questions && <pre>{info.questions}</pre>}
                </details>
              </>
            }
            links={
              <RelatedPanel
                id={info.id}
                onOpen={(id) => {
                  setInfo(null);
                  open(id);
                }}
                onChanged={onChanged}
                onExplore={(id) => setExplore(id)}
              />
            }
            ai={
              <ContextAssistant
                entry={info}
                onChanged={onChanged}
                onOpen={(id) => {
                  setInfo(null);
                  open(id);
                }}
              />
            }
          >
            <h1>{info.title}</h1>
            <div
              className="prose"
              data-reading-id={info.id}
              data-reading-title={info.title}
              dangerouslySetInnerHTML={{ __html: info.content }}
            />
          </ReaderPanels>
        </ReadingSurface>
      )}
      {!!rawSource && (
        <Dialog title="导入原始包" wide onClose={() => setRawSource('')}>
          <pre>{rawSource}</pre>
        </Dialog>
      )}
      {editing && (
        <KnowledgeEditor
          id={editing.id}
          initial={editing.form}
          dirs={legacyDirs}
          meta={meta}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            onChanged();
            open(id);
          }}
        />
      )}
      {manage && (
        <Dialog
          title="管理领域树"
          onClose={() => {
            if (!busy && (!treeDirty || confirm('领域调整尚未保存，确认关闭并放弃修改？')))
              setManage(false);
          }}
        >
          <p>
            主要领域和跨领域关联共用此树。删除非空领域前，请在内容编辑中调整归属，并将子领域移到其他父级；规则或保存筛选的引用由服务端再次检查。不会删除知识内容。
          </p>
          <form
            className="domain-management-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/taxonomy/domains' + (treeForm.id ? '/' + treeForm.id : ''), {
                  method: treeForm.id ? 'PUT' : 'POST',
                  body: JSON.stringify({
                    name: treeForm.name,
                    parent_id: treeForm.parent_id || null,
                    position: treeForm.position,
                  }),
                });
                setTreeForm({ id: '', name: '', parent_id: '', position: 0 });
                onChanged();
              });
            }}
          >
            <label>
              领域名称
              <input
                aria-label="领域名称"
                required
                maxLength={50}
                value={treeForm.name}
                onChange={(e) => setTreeForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label>
              父领域
              <select
                aria-label="父领域"
                value={treeForm.parent_id}
                onChange={(e) => setTreeForm((f) => ({ ...f, parent_id: e.target.value }))}
              >
                <option value="">根领域</option>
                {domains
                  .filter(
                    (d) =>
                      d.id !== treeForm.id &&
                      !domainOutline(domains, treeForm.id).some((c) => c.id === d.id),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              同层顺序
              <input
                aria-label="领域顺序"
                type="number"
                min={0}
                value={treeForm.position}
                onChange={(e) => setTreeForm((f) => ({ ...f, position: Number(e.target.value) }))}
              />
            </label>
            <button
              type="button"
              onClick={() => setTreeForm({ id: '', name: '', parent_id: '', position: 0 })}
            >
              新增 / 取消调整
            </button>
            <button className="primary" disabled={busy}>
              {treeForm.id ? '保存领域' : '创建领域'}
            </button>
          </form>
          <DomainTree
            rows={domains}
            selected={treeForm.id}
            onSelect={(d) =>
              setTreeForm({ ...domains.find((x) => x.id === d.id)!, parent_id: d.parent_id || '' })
            }
            actions={(d) => (
              <>
                <button
                  onClick={() => setTreeForm({ id: '', name: '', parent_id: d.id, position: 0 })}
                  aria-label={'添加子领域 ' + d.name}
                >
                  ＋
                </button>
                <button
                  aria-label={'调整领域 ' + d.name}
                  onClick={() =>
                    setTreeForm({
                      ...domains.find((x) => x.id === d.id)!,
                      parent_id: d.parent_id || '',
                    })
                  }
                >
                  调整
                </button>
                <button
                  disabled={busy || !!d.count || domains.some((x) => x.parent_id === d.id)}
                  title="先移动内容及子领域；规则或视图引用由服务端再次检查"
                  onClick={() =>
                    run(async () => {
                      if (!confirm('删除空领域 ' + d.name + '？ID关联由服务端核对。')) return;
                      await api('/taxonomy/domains/' + d.id, { method: 'DELETE' });
                      onChanged();
                    })
                  }
                >
                  删除
                </button>
              </>
            )}
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {ruleOpen && (
        <Dialog title="专题动态筛选规则" onClose={() => !busy && setRuleOpen(false)}>
          <p>
            规则成员按领域（含子领域）、标签、类型求交集；同类条件求并集。不会移除人工成员。空条件代表全部根内容。
          </p>
          {(['domains', 'tags', 'types'] as const).map((k) => (
            <label key={k}>
              {k === 'domains' ? '领域' : k === 'tags' ? '标签' : '内容类型'}
              <select
                multiple
                aria-label={'规则 ' + k}
                value={rule[k]}
                onChange={(e) =>
                  setRule((r: any) => ({
                    ...r,
                    [k]: Array.from(e.target.selectedOptions).map((o) => o.value),
                  }))
                }
              >
                {(k === 'types'
                  ? Object.entries(contentLabels)
                      .filter(([id]) =>
                        ['note', 'bookmark', 'tool', 'document', 'mindmap'].includes(id),
                      )
                      .map(([id, name]) => ({ id, name }))
                  : meta[k]
                ).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p>
            当前规则匹配 {ruleMembers?.ids.length || 0} 条，人工成员{' '}
            {ruleMembers?.manual.length || 0} 条；保存时服务端重新校验。
          </p>
          <button
            disabled={busy}
            className="primary"
            onClick={() =>
              run(async () => {
                const candidate = await libraryWrite(
                  '/collections/' + topic + '/rules/preview',
                  'POST',
                  { rules: rule },
                );
                if (
                  !confirm(
                    '确认专题筛选规则？新规则匹配' + candidate.ids.length + '条，原手工成员保留。',
                  )
                )
                  return;
                await libraryWrite('/collections/' + topic + '/rules', 'PUT', {
                  rules: rule,
                  confirm: '确认专题筛选规则',
                });
                setRuleOpen(false);
                onChanged();
              })
            }
          >
            确认规则
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!confirm('关闭动态规则？人工成员保留。')) return;
                await libraryWrite('/collections/' + topic + '/rules', 'PUT', {
                  rules: null,
                  confirm: '确认专题筛选规则',
                });
                setRuleOpen(false);
                onChanged();
              })
            }
          >
            关闭动态规则
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
