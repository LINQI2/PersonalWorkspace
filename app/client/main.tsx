import { MindmapEditor, createMindmap } from './MindmapEditor';
import {
  rememberReadingOrigin,
  clearReadingOrigin,
  returnReadingOrigin,
} from './readingNavigation';
import { ContentPreview } from './ContentPreview';
import { ReaderPanels } from './ReaderWorkbench';
import {
  ContextAssistant,
  QuickDialog,
  Workbench,
  InboxPage,
  ReadingSurface,
  ContentActions,
  SettingsHome,
  TrashPanel,
  ImportDialog,
} from './Experience';
import { DomainTree } from './DomainTree';
import React, { useEffect, useRef, useState } from 'react';
import {
  Library,
  Search,
  Plus,
  Settings,
  Layers,
  Folder,
  FileText,
  Inbox,
  ArrowUpRight,
  Pencil,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Pin,
  Sun,
  Moon,
  BookOpen,
  Check,
  List,
  LayoutGrid,
  SlidersHorizontal,
  CheckSquare,
  Wrench,
} from 'lucide-react';
import { api, blank, toolLabels, type Kind, type Entry, type Form, type Meta } from './shared';
import { createRoot } from 'react-dom/client';
import { Cover, Dialog, source } from './components';
import { EntryEditor } from './EntryEditor';
import { BatchDialog, SettingsPanel } from './SettingsPanel';
import { CollectionPage } from './CollectionPage';
import { AiStatusBadge } from './AiSettings';
import { UnifiedLibrary } from './UnifiedLibrary';
import { ContentProvenance } from './ContentProvenance';
import { KnowledgeWorkspace } from './KnowledgeWorkspace';
import { Assistant } from './Assistant';
import './assistant.css';
import './style.css';
import './relations.css';
import { RelatedPanel } from './RelatedPanel';
import './unified.css';
import './experience.css';
import './reading-v18.css';
import { PasteImport } from './PasteImport';
function App() {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<Entry | null>(null),
    [quickOpen, setQuickOpen] = useState(false),
    [settingsHome, setSettingsHome] = useState(false),
    [trashOpen, setTrashOpen] = useState(false),
    [importGlobal, setImportGlobal] = useState(false),
    [sidebarClosed, setSidebarClosed] = useState(
      () =>
        localStorage.getItem('pk-sidebar') === 'closed' ||
        (innerWidth < 760 && localStorage.getItem('pk-sidebar') !== 'open'),
    ),
    [libraryScope, setLibraryScope] = useState<{
      domain: string;
      topic: string;
      query: string;
      nonce: number;
      tag?: string;
    }>({ domain: '', topic: '', query: '', nonce: 0 }),
    [groupFold, setGroupFold] = useState<string[]>([]),
    [shellSelected, setShellSelected] = useState({ domain: '', topic: '' }),
    [shellDomains, setShellDomains] = useState<any[]>([]),
    [treeFold, setTreeFold] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('pk-domain-fold') || '[]');
      } catch {
        return [];
      }
    });
  useEffect(() => {
    const media = matchMedia('(max-width:760px)');
    const adapt = () => {
      if (media.matches) setSidebarClosed(true);
    };
    media.addEventListener('change', adapt);
    return () => media.removeEventListener('change', adapt);
  }, []);
  const [meta, setMeta] = useState<Meta>();
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('all');
  const [knowledgeOpen, setKnowledgeOpen] = useState('');
  const [knowledgeDirectory, setKnowledgeDirectory] = useState('');
  const [assistantTab, setAssistantTab] = useState('ask');
  const [toolKind, setToolKind] = useState('');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [domain, setDomain] = useState('');
  const [tag, setTag] = useState('');
  const [collection, setCollection] = useState('');
  const [topicId, setTopicId] = useState('');
  const topicLeave = useRef<(() => Promise<boolean>) | undefined>(undefined);
  const [sort, setSort] = useState('recent');
  const [layout, setLayout] = useState('grid');
  const [prefsReady, setPrefsReady] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  useEffect(() => {
    api('/preferences')
      .then((p) => {
        setSort(p.sort);
        setLayout(p.layout);
        setPrefsReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  const preference = (value: { layout?: string; sort?: string }) => {
    api('/preferences', { method: 'PUT', body: JSON.stringify(value) })
      .then((p) => {
        setLayout(p.layout);
        setSort(p.sort);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(() => setSelected([]), [term, view, toolKind, domain, tag, collection, page, sort]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [detail, setDetail] = useState<Entry | null>(null);
  const [detailError, setDetailError] = useState('');
  const [contentHistory, setContentHistory] = useState<any[] | null>(null);
  useEffect(() => setDetailError(''), [detail]);
  const [editing, setEditing] = useState<{
    id?: string;
    form: Form;
    cover?: string | null;
    updatedAt?: string;
    embedded?: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<{
    section?: 'classification' | 'ai' | 'backup' | 'service';
    kind?: Kind;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [dark, setDark] = useState(() => localStorage.getItem('pk-theme') === 'dark');
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = () => setRevision((n) => n + 1);
  const notify = (s: string) => {
    setToast(s);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('pk-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    let current = true;
    api<Meta>('/meta')
      .then((m) => {
        if (current) setMeta(m);
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [revision]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    const params = new URLSearchParams({
      q: term,
      library: '1',
      view,
      tool_kind: view === 'tools' ? toolKind : '',
      domains: domain,
      tags: tag,
      collections: collection,
      sort,
      page: String(page),
    });
    api<{ items: Entry[]; total: number }>('/entries?' + params)
      .then((data) => {
        if (current) {
          setItems(data.items);
          setTotal(data.total);
          if (page > Math.max(1, Math.ceil(data.total / 24)))
            setPage(Math.max(1, Math.ceil(data.total / 24)));
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [term, view, toolKind, domain, tag, collection, sort, page, revision]);
  const fullEntry = () =>
    setEditing({
      form: {
        ...blank(),
        ...(view === 'tools'
          ? { type: 'note' as const, resource_kind: 'tool' as const, tool_kind: 'online' as const }
          : {}),
        domains: domain ? [domain] : [],
        collections: collection ? [collection] : [],
        tags: tag ? [tag] : [],
      },
    });
  const newEntry = () => {
    if (editing) {
      notify('请先保存或取消当前编辑。');
      return;
    }
    setQuickOpen(true);
  };
  const clearFilters = () => {
    setDomain('');
    setToolKind('');
    setTag('');
    setCollection('');
    setQuery('');
    setPage(1);
  };
  const pin = async (entry: Entry) => {
    setActionBusy(true);
    try {
      await api('/entries/' + entry.id + '/pin', {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !entry.pinned }),
      });
      refresh();
      notify(entry.pinned ? '已取消置顶' : '已置顶');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };
  const batch = async (payload: object) => {
    setActionBusy(true);
    try {
      await api('/batch', { method: 'POST', body: JSON.stringify({ ids: selected, ...payload }) });
      setSelected([]);
      setBatchOpen(false);
      refresh();
      notify('已完成批量整理');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };
  const toggleSelection = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !document.querySelector('[role="dialog"]') &&
        !editing &&
        !settings &&
        !detail &&
        (e.ctrlKey || e.metaKey) &&
        e.key === 'k'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        e.key.toLowerCase() === 'n' &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !editing &&
        !settings &&
        !detail &&
        !document.querySelector('[role="dialog"]') &&
        !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')
      ) {
        e.preventDefault();
        newEntry();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editing, settings, detail, view, domain, tag, collection]);
  const nav = async (nextView: string, d = '', c = '') => {
    const mapGuard = { check: null as null | (() => Promise<boolean>) };
    window.dispatchEvent(new CustomEvent('pk-map-leave-check', { detail: mapGuard }));
    if (mapGuard.check && !(await mapGuard.check())) return false;
    if (editing) {
      notify('请先保存或取消当前编辑。');
      return false;
    }
    const quickText = document.querySelector<HTMLTextAreaElement>('.quick-record textarea');
    if (quickText?.value.trim() && !confirm('快速记录尚未保存，确认离开此页面？')) return false;
    if (topicLeave.current && !(await topicLeave.current())) return false;
    if (nextView === 'tools' && !d && !c) clearFilters();
    clearReadingOrigin();
    window.dispatchEvent(new Event('pk-close-readers'));
    setDetail(null);
    history.replaceState(null, '', location.pathname + location.search);
    setTopicId(c);
    setKnowledgeOpen('');
    setKnowledgeDirectory('');
    setView(nextView);
    setDomain(d);
    setCollection(c);
    setPage(1);
    return true;
  };
  const edit = (entry: Entry) => {
    if (entry.mindmap) {
      void openContent(entry.id);
      return;
    }
    const embedded =
      detail?.id === entry.id &&
      entry.type === 'note' &&
      entry.resource_kind !== 'tool' &&
      !entry.knowledge_kind &&
      entry.content.length <= 10000;
    if (!embedded) setDetail(null);
    setEditing({
      id: entry.id,
      embedded,
      cover: entry.cover,
      updatedAt: entry.updated_at,
      form: {
        ...entry,
        url: entry.url || '',
        domains: entry.domains.map((x) => x.id),
        tags: entry.tags.map((x) => x.id),
        collections: entry.collections.map((x) => x.id),
      },
    });
  };
  useEffect(() => {
    const show = async (id: string) => {
      try {
        const requestedHash = location.hash;
        const e = await api<Entry>('/entries/' + id);
        if (location.hash !== requestedHash) return;
        if (e.knowledge_kind) {
          if (await nav('library')) {
            setDetail(null);
            setKnowledgeOpen('');
            setTimeout(() => setKnowledgeOpen(id), 0);
            history.replaceState(null, '', '#content-' + id);
          }
        } else {
          window.dispatchEvent(new Event('pk-close-readers'));
          setDetail(e);
        }
      } catch {
        notify('站内引用不存在或已变化，请核对来源ID。');
      }
    };
    let restoringHistory = false;
    const readHash = () => {
      if (restoringHistory) {
        restoringHistory = false;
        return;
      }
      const check = { dirty: false, busy: false, close: [] as (() => void)[] };
      window.dispatchEvent(new CustomEvent('pk-history-check', { detail: check }));
      if (
        check.busy ||
        (check.dirty && !confirm('编辑尚未保存，确认放弃当前编辑并返回？请先保存重要输入。'))
      ) {
        restoringHistory = true;
        history.forward();
        return;
      }
      check.close.forEach((close) => close());

      const quote = location.hash.match(/^#quote-([a-f0-9-]{36})$/);
      if (quote) {
        api('/reading/mark/' + quote[1])
          .then((m) => {
            if (location.hash !== '#quote-' + quote[1]) return;
            sessionStorage.setItem('pk-pending-mark', m.id);
            show(m.source_id);
          })
          .catch(() => notify('引用定位记录不存在；请查阅保留的摘录与来源。'));
        return;
      }
      const preview = location.hash.match(/^#preview-([a-f0-9-]{36})$/);
      if (preview) {
        setDetail(null);
        window.dispatchEvent(new Event('pk-history-close'));
        api<Entry>('/entries/' + preview[1])
          .then((entry) => {
            if (location.hash === '#preview-' + preview[1]) setPreviewEntry(entry);
          })
          .catch(() => notify('预览内容不存在'));
        return;
      }
      const m = location.hash.match(/^#(?:content|chapter)-([a-f0-9-]{36})$/);
      if (m) {
        setPreviewEntry(null);
        show(m[1]);
      } else {
        setDetail(null);
        setPreviewEntry(null);
        window.dispatchEvent(new Event('pk-history-close'));
      }
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const a = (e.target as HTMLElement).closest('a[data-entry-id]');
      const id = a?.getAttribute('data-entry-id');
      if (id && /^[a-f0-9-]{36}$/.test(id)) {
        e.preventDefault();
        const mark = a?.getAttribute('data-reading-mark');
        if (mark && /^[a-f0-9-]{36}$/.test(mark)) {
          api('/reading/mark/' + mark)
            .then((m) => {
              if (m.source_id !== id) {
                notify('引用来源不一致，请核对原始摘录。');
                return;
              }
              sessionStorage.setItem('pk-pending-mark', mark);
              window.dispatchEvent(new CustomEvent('pk-open-mark-source', { detail: id }));
            })
            .catch(() => {
              notify('引用定位记录已删除，原始摘录仍保留；打开来源供人工核对。');
              show(id);
            });
          return;
        }
        show(id);
      }
    };
    window.addEventListener('hashchange', readHash);
    document.addEventListener('click', click);
    readHash();
    return () => {
      window.removeEventListener('hashchange', readHash);
      document.removeEventListener('click', click);
    };
  }, []);
  useEffect(() => {
    api('/library/domains')
      .then(setShellDomains)
      .catch(() => {});
  }, [revision]);
  useEffect(() => {
    const sync = (e: Event) => {
      const current = (e as CustomEvent).detail;
      setShellSelected({ domain: current.domain, topic: current.topic });
      setLibraryScope((previous) => (previous ? { ...previous, ...current } : previous));
    };
    window.addEventListener('pk-library-scope', sync);
    return () => window.removeEventListener('pk-library-scope', sync);
  }, []);
  const setShellScope = async (d = '', c = '') => {
    if (await nav('library'))
      setLibraryScope({ domain: d, topic: c, query: '', nonce: Date.now() });
  };
  const remember = (id: string) => {
    sessionStorage.setItem('pk-last-read', id);
    if (location.hash !== '#content-' + id)
      history.pushState(
        {
          pkReader: true,
          fromReading: document.querySelector<HTMLElement>('.reading-surface [data-reader-id]')
            ?.dataset.readerId,
        },
        '',
        '#content-' + id,
      );
  };
  const openContent = async (id: string) => {
    const mapGuard = { check: null as null | (() => Promise<boolean>) };
    window.dispatchEvent(new CustomEvent('pk-map-leave-check', { detail: mapGuard }));
    if (mapGuard.check && !(await mapGuard.check())) return;
    rememberReadingOrigin(view);
    const pending = document.querySelector<HTMLTextAreaElement>('.quick-record textarea');
    if (pending?.value.trim() && !confirm('快速记录尚未保存，确认切换内容？')) return;
    const requestedHash = location.hash;
    const e = await api<Entry>('/entries/' + id);
    if (location.hash !== requestedHash) return;
    remember(id);
    window.dispatchEvent(new Event('pk-close-readers'));
    setDetail(null);
    setPreviewEntry(null);
    if (e.knowledge_kind) {
      setView('library');
      setKnowledgeOpen('');
      setTimeout(() => setKnowledgeOpen(id), 0);
    } else setDetail(e);
  };
  useEffect(() => {
    const open = (e: Event) => void openContent((e as CustomEvent).detail);
    window.addEventListener('pk-open-mark-source', open);
    return () => window.removeEventListener('pk-open-mark-source', open);
  }, [view]);
  const browseContent = async (id: string) => {
    const e = await api<Entry>('/entries/' + id);
    if (e.mindmap) {
      void openContent(id);
      return;
    }
    if (e.knowledge_kind) {
      const r = await api('/knowledge/records/' + id);
      if (r.kind === 'page' || r.page_id) {
        openContent(id);
        return;
      }
    }
    setPreviewEntry(e);
  };
  useEffect(() => {
    const query = matchMedia('(max-width:760px)'),
      close = () => {
        if (query.matches) setSidebarClosed(true);
      };
    query.addEventListener('change', close);
    return () => query.removeEventListener('change', close);
  }, []);
  useEffect(() => {
    const back = (e: Event) => {
      const target = (e as CustomEvent).detail;
      setDetail(null);
      setKnowledgeOpen('');
      setView(target);
    };
    window.addEventListener('pk-reading-return', back);
    return () => window.removeEventListener('pk-reading-return', back);
  }, []);
  const primaryNav = [
    ['all', '首页'],
    ['capture', '收集箱'],
    ['library', '知识库'],
    ['assistant', 'AI 助手'],
  ];
  const heading =
    view === 'assistant'
      ? 'AI 助手'
      : domain
        ? meta?.domains.find((x) => x.id === domain)?.name
        : collection
          ? meta?.collections.find((x) => x.id === collection)?.name
          : view === 'pending'
            ? '待整理'
            : view === 'notes'
              ? '我的笔记'
              : view === 'tools'
                ? '工具库'
                : ['knowledge', 'library'].includes(view)
                  ? '知识库'
                  : view === 'capture'
                    ? '收集箱'
                    : '首页';
  return (
    <>
      <div className={'shell experience-shell ' + (sidebarClosed ? 'sidebar-closed' : '')}>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-icon">
              <Library size={23} />
            </span>
            <div>
              知识收藏馆<small>YOUR PERSONAL LIBRARY</small>
            </div>
          </div>
          <div className="workspace-label">
            我的知识空间 <span>本地</span>
          </div>
          <nav aria-label="侧栏一级导航">
            <button
              title="首页"
              className={view === 'all' && !topicId ? 'active' : ''}
              onClick={() => nav('all')}
            >
              <Layers size={18} />
              首页
            </button>
            <button
              title="收集箱"
              className={view === 'capture' ? 'active' : ''}
              onClick={() => nav('capture')}
            >
              <Inbox size={18} />
              收集箱
            </button>
            <button
              title="知识库"
              className={['library', 'knowledge'].includes(view) || topicId ? 'active' : ''}
              onClick={() => nav('library')}
            >
              <Library size={18} />
              知识库
            </button>
            <button
              title="AI 助手"
              className={view === 'assistant' ? 'active' : ''}
              onClick={async () => {
                if (await nav('assistant')) setAssistantTab('ask');
              }}
            >
              <BookOpen size={18} />
              AI 助手
            </button>
          </nav>
          <div className="shell-structure">
            {(['domains', 'collections'] as const).map((group) => (
              <section key={group}>
                <div className="structure-heading">
                  <button
                    className="tree-arrow"
                    aria-label={'折叠' + (group === 'domains' ? '领域树' : '专题')}
                    aria-expanded={!groupFold.includes(group)}
                    onClick={() =>
                      setGroupFold((xs) =>
                        xs.includes(group) ? xs.filter((x) => x !== group) : [...xs, group],
                      )
                    }
                  >
                    {groupFold.includes(group) ? '▸' : '▾'}
                  </button>
                  <span>{group === 'domains' ? '领域树' : '专题'}</span>
                  <button
                    aria-label={group === 'domains' ? '管理领域' : '管理专题'}
                    title="添加或管理分类"
                    onClick={() => setSettings({ kind: group })}
                  >
                    ＋
                  </button>
                </div>
                {!groupFold.includes(group) &&
                  (group === 'domains' ? (
                    <>
                      <button className="all-domains" onClick={() => setShellScope()}>
                        全部领域
                      </button>
                      <DomainTree
                        rows={shellDomains}
                        selected={view === 'library' ? shellSelected.domain : undefined}
                        onSelect={(d) => setShellScope(d.id)}
                        folded={treeFold}
                        onFold={(id) =>
                          setTreeFold((xs) => {
                            const next = xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id];
                            localStorage.setItem('pk-domain-fold', JSON.stringify(next));
                            return next;
                          })
                        }
                      />
                      {!shellDomains.length && <small>在设置中添加领域</small>}
                    </>
                  ) : (
                    meta?.collections.map((c) => (
                      <div
                        className={
                          'domain-node ' +
                          (view === 'library' && shellSelected.topic === c.id ? 'selected' : '')
                        }
                        key={c.id}
                      >
                        <span className="tree-arrow">·</span>
                        <button
                          className="tree-name"
                          title={c.name}
                          onClick={() => setShellScope('', c.id)}
                        >
                          {c.name}
                        </button>
                        <small className="tree-count">{c.count}</small>
                      </div>
                    ))
                  ))}
              </section>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="local-status">
              <span />
              数据仅保存在这台电脑
            </div>
            <button title="设置" onClick={() => setSettings({})}>
              <Settings size={17} />
              设置
            </button>
          </div>
        </aside>
        <main>
          <header className="topbar global-topbar">
            <button
              className="icon"
              aria-label="收起或展开侧栏"
              aria-expanded={!sidebarClosed}
              onClick={() => {
                setSidebarClosed(!sidebarClosed);
                localStorage.setItem('pk-sidebar', sidebarClosed ? 'open' : 'closed');
              }}
            >
              ☰
            </button>
            <strong className="top-brand">知识收藏馆</strong>
            <nav aria-label="顶部一级导航">
              {primaryNav.map(([k, v]) => (
                <button
                  key={k}
                  className={
                    (view === k && (k !== 'all' || !topicId)) ||
                    (k === 'library' && (view === 'knowledge' || !!topicId))
                      ? 'active'
                      : ''
                  }
                  onClick={() => nav(k)}
                >
                  {v}
                </button>
              ))}
            </nav>
            <form
              className="global-search"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await nav('library'))
                  setLibraryScope({ domain: '', topic: '', query, nonce: Date.now() });
              }}
            >
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="全局搜索"
                placeholder="搜索知识与来源…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
            <div className="top-actions">
              <AiStatusBadge onOpen={() => setSettings({ section: 'ai' })} />
              <button className="primary" onClick={newEntry}>
                ＋ 新建
              </button>
              <button className="icon" aria-label="设置" onClick={() => setSettings({})}>
                <Settings size={18} />
              </button>
              <button className="icon" aria-label="切换主题" onClick={() => setDark(!dark)}>
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </header>
          <div className="content">
            {view === 'all' && !topicId && meta ? (
              <Workbench
                meta={meta}
                revision={revision}
                onChanged={refresh}
                onOpen={browseContent}
                onInbox={() => nav('capture')}
                onEdit={edit}
              />
            ) : view === 'capture' && meta ? (
              <InboxPage
                meta={meta}
                revision={revision}
                onChanged={refresh}
                onOpen={browseContent}
                onEdit={edit}
              />
            ) : view === 'assistant' ? (
              <Assistant
                onChanged={refresh}
                registerLeave={(fn) => {
                  topicLeave.current = fn;
                }}
                initialTab={assistantTab}
                onOpen={async (key) => {
                  const [kind, id] = key.split(':');
                  if (kind === 'entries') {
                    const entry = await api<Entry>('/entries/' + id);
                    if (entry.knowledge_kind) {
                      if (await nav('library')) setKnowledgeOpen(id);
                    } else {
                      if (await nav('all')) setDetail(entry);
                    }
                  } else if (kind === 'directories') {
                    if (await nav('library')) setKnowledgeDirectory(id);
                  } else if (kind === 'collections') await nav('all', '', id);
                  else if (kind === 'domains') await setShellScope(id);
                  else if (kind === 'tags') {
                    if (await nav('library'))
                      setLibraryScope({
                        domain: '',
                        topic: '',
                        query: '',
                        tag: id,
                        nonce: Date.now(),
                      });
                  }
                }}
              />
            ) : (view === 'library' || view === 'knowledge') && meta ? (
              <UnifiedLibrary
                scope={libraryScope}
                onEditEntry={edit}
                meta={meta}
                revision={revision}
                initialOpen={knowledgeOpen}
                onChanged={refresh}
                registerLeave={(fn) => {
                  topicLeave.current = fn;
                }}
                onOpen={(id) => openContent(id).catch((e) => setError(e.message))}
                onCreate={(form) => setEditing({ form })}
                onStructure={async () => {
                  if (await nav('assistant')) setAssistantTab('structure');
                }}
                onTopic={(id) => nav('all', '', id)}
              />
            ) : topicId && meta ? (
              <CollectionPage
                key={topicId}
                id={topicId}
                revision={revision}
                onChanged={refresh}
                registerLeave={(handler) => {
                  topicLeave.current = handler;
                }}
                onNew={fullEntry}
                onOpen={(id) => {
                  api<Entry>('/entries/' + id)
                    .then(setDetail)
                    .catch((e) => notify('来源暂不可用：' + e.message));
                }}
              />
            ) : (
              <>
                <div className="intro">
                  <div>
                    <div className="eyebrow">COLLECT · CONNECT · CREATE</div>
                    <h1>
                      {heading || '全部收藏'}
                      <span className="count-badge">{total}</span>
                    </h1>
                    <p>
                      {view === 'pending'
                        ? '给灵感找到合适的位置，从一个领域开始。'
                        : view === 'notes'
                          ? '记录自己的理解，留住思考的轨迹。'
                          : view === 'tools'
                            ? '把好用的工具放在手边，留下自己的使用经验。'
                            : '把值得留住的链接与想法，放进自己的知识空间。'}
                    </p>
                  </div>
                  <div className="intro-mark">
                    {view === 'tools' ? <Wrench size={38} /> : <BookOpen size={38} />}
                  </div>
                </div>
                <div className="filterbar">
                  <div className="search">
                    <Search size={18} />
                    <input
                      ref={searchRef}
                      aria-label="搜索收藏"
                      placeholder="搜索标题、简介或笔记内容…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query ? (
                      <button aria-label="清空搜索" onClick={() => setQuery('')}>
                        <X size={15} />
                      </button>
                    ) : (
                      <kbd>Ctrl K</kbd>
                    )}
                  </div>
                  <select
                    aria-label="标签筛选"
                    value={tag}
                    onChange={(e) => {
                      setTag(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">所有标签</option>
                    {meta?.tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    disabled={!prefsReady}
                    aria-label="排序"
                    value={sort}
                    onChange={(e) => {
                      preference({ sort: e.target.value });
                      setPage(1);
                    }}
                  >
                    <option value="recent">最近添加</option>
                    <option value="updated">最近更新</option>
                    <option value="pinned">置顶优先</option>
                    <option value="oldest">最早添加</option>
                    <option value="title">标题 A–Z</option>
                  </select>
                  <div className="view-toggle" aria-label="浏览方式">
                    <button
                      aria-label="网格视图"
                      title="网格视图"
                      className={layout === 'grid' ? 'selected' : ''}
                      disabled={!prefsReady}
                      onClick={() => preference({ layout: 'grid' })}
                    >
                      <LayoutGrid size={18} />
                    </button>
                    <button
                      aria-label="列表视图"
                      title="列表视图"
                      className={layout === 'list' ? 'selected' : ''}
                      disabled={!prefsReady}
                      onClick={() => preference({ layout: 'list' })}
                    >
                      <List size={18} />
                    </button>
                  </div>
                </div>
                <div className="browse-controls">
                  {view === 'tools' && (
                    <select
                      aria-label="工具类型筛选"
                      value={toolKind}
                      onChange={(e) => {
                        setToolKind(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">所有工具类型</option>
                      {Object.entries(toolLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="text-button"
                    aria-label="管理标签"
                    onClick={() => setSettings({ kind: 'tags' })}
                  >
                    管理标签 +
                  </button>
                  <select
                    aria-label="专题筛选"
                    value={collection}
                    onChange={(e) => {
                      setCollection(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">所有专题</option>
                    {meta?.collections.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span>{loading ? '正在查找…' : total + ' 条内容'}</span>
                  <button
                    className={managing ? 'selected' : ''}
                    onClick={() => {
                      setManaging(!managing);
                      setSelected([]);
                    }}
                  >
                    <CheckSquare size={16} />
                    {managing ? '完成管理' : '批量管理'}
                  </button>
                </div>
                <div className="domain-bar">
                  <button
                    className={!domain ? 'selected' : ''}
                    onClick={() => {
                      setDomain('');
                      setPage(1);
                    }}
                  >
                    全部领域
                  </button>
                  {meta?.domains.map((d) => (
                    <button
                      key={d.id}
                      className={domain === d.id ? 'selected' : ''}
                      onClick={() => {
                        setDomain(d.id);
                        setPage(1);
                      }}
                    >
                      {d.name}
                    </button>
                  ))}
                  {collection && (
                    <button
                      className="selected"
                      onClick={() => {
                        setCollection('');
                        setPage(1);
                      }}
                    >
                      <Folder size={13} />
                      {meta?.collections.find((c) => c.id === collection)?.name}
                      <X size={12} />
                    </button>
                  )}
                </div>
                {(query || tag || domain || collection) && (
                  <div className="filter-summary">
                    <SlidersHorizontal size={14} />
                    <span>当前筛选</span>
                    {query && (
                      <button onClick={() => setQuery('')}>
                        搜索：{query}
                        <X size={12} />
                      </button>
                    )}
                    {domain && (
                      <button
                        onClick={() => {
                          setDomain('');
                          setPage(1);
                        }}
                      >
                        {meta?.domains.find((t) => t.id === domain)?.name}
                        <X size={12} />
                      </button>
                    )}
                    {tag && (
                      <button
                        onClick={() => {
                          setTag('');
                          setPage(1);
                        }}
                      >
                        #{meta?.tags.find((t) => t.id === tag)?.name}
                        <X size={12} />
                      </button>
                    )}
                    <button className="text-button" onClick={clearFilters}>
                      清除筛选
                    </button>
                  </div>
                )}
                {managing && (
                  <div className="batch-bar">
                    <label>
                      <input
                        type="checkbox"
                        aria-label="全选当前页"
                        disabled={loading || actionBusy}
                        checked={!!items.length && selected.length === items.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? items.map((x) => x.id) : [])
                        }
                      />
                      当前页
                    </label>
                    <strong>已选 {selected.length} 条</strong>
                    <button
                      disabled={!selected.length || actionBusy || loading}
                      onClick={() => setBatchOpen(true)}
                    >
                      添加分类 / 标签
                    </button>
                    <button
                      disabled={!selected.length || actionBusy || loading}
                      onClick={() => batch({ action: 'pin' })}
                    >
                      置顶
                    </button>
                    <button
                      disabled={!selected.length || actionBusy || loading}
                      onClick={() => batch({ action: 'unpin' })}
                    >
                      取消置顶
                    </button>
                    <button
                      className="danger-text"
                      disabled={!selected.length || actionBusy || loading}
                      onClick={() => {
                        if (
                          confirm(
                            '确定删除所选 ' +
                              selected.length +
                              ' 条内容？条目无法撤销，图片文件仍保留。',
                          )
                        )
                          batch({ action: 'delete', confirm: '删除所选条目' });
                      }}
                    >
                      删除所选
                    </button>
                  </div>
                )}
                {error && (
                  <div className="error" role="alert">
                    {error}
                    <button onClick={refresh}>重试</button>
                  </div>
                )}
                {loading ? (
                  <div className="skeleton-grid">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <div key={n} className="skeleton" />
                    ))}
                  </div>
                ) : items.length ? (
                  <>
                    <div
                      className={
                        'grid ' +
                        (view === 'tools' ? 'tools-grid ' : '') +
                        (layout === 'list' ? 'list-view' : '')
                      }
                    >
                      {items.map((entry) => (
                        <article
                          className={
                            'card ' +
                            (entry.resource_kind === 'tool' ? 'tool-card ' : '') +
                            (selected.includes(entry.id) ? 'is-selected' : '')
                          }
                          key={entry.id}
                        >
                          {managing && (
                            <label className="card-select">
                              <input
                                type="checkbox"
                                aria-label={'选择 ' + entry.title}
                                checked={selected.includes(entry.id)}
                                onChange={() => toggleSelection(entry.id)}
                              />
                            </label>
                          )}
                          <button
                            className="card-main"
                            aria-label={'查看 ' + entry.title}
                            onClick={() =>
                              managing
                                ? toggleSelection(entry.id)
                                : entry.knowledge_kind
                                  ? (setKnowledgeOpen(entry.id),
                                    setView('knowledge'),
                                    setTopicId(''))
                                  : setDetail(entry)
                            }
                          >
                            <Cover entry={entry} />
                            <div className="card-body">
                              <div className="card-source">
                                {entry.type === 'note' ? (
                                  <FileText size={12} />
                                ) : (
                                  <span className="source-dot" />
                                )}
                                {source(entry)}
                                {entry.pinned === 1 && <Pin size={12} />}
                              </div>
                              <h3>{entry.title}</h3>
                              <p>
                                {entry.description ||
                                  (entry.resource_kind === 'tool'
                                    ? '编辑工具，补充用途与使用经验。'
                                    : entry.type === 'note'
                                      ? '打开笔记，继续思考。'
                                      : '留住灵感，随时回来阅读。')}
                              </p>
                              <div className="chips">
                                {entry.domains.slice(0, 2).map((d) => (
                                  <span key={d.id}>{d.name}</span>
                                ))}
                                {entry.tags.slice(0, 2).map((t) => (
                                  <span className="tag-chip" key={t.id}>
                                    #{t.name}
                                  </span>
                                ))}
                                {!entry.domains.length && <span>待整理</span>}
                              </div>
                            </div>
                          </button>
                          {entry.resource_kind === 'tool' && (
                            <details className="tool-notes">
                              <summary>个人备注{entry.content ? '' : ' · 待补充'}</summary>
                              <div
                                className="prose"
                                dangerouslySetInnerHTML={{
                                  __html:
                                    entry.content ||
                                    '<p>编辑工具，记录优缺点、使用经验和注意事项。</p>',
                                }}
                              />
                            </details>
                          )}
                          <div className="card-footer">
                            <span>
                              {new Date(
                                sort === 'updated' ? entry.updated_at : entry.created_at,
                              ).toLocaleDateString('zh-CN')}{' '}
                              {sort === 'updated' ? '更新' : '收藏'}
                            </span>
                            <div>
                              <button
                                className={'icon pin-action ' + (entry.pinned ? 'is-pinned' : '')}
                                disabled={actionBusy}
                                aria-label={(entry.pinned ? '取消置顶 ' : '置顶 ') + entry.title}
                                title={entry.pinned ? '取消置顶' : '置顶'}
                                onClick={() => pin(entry)}
                              >
                                <Pin size={15} />
                              </button>
                              <button
                                className="icon"
                                aria-label={'编辑 ' + entry.title}
                                title="编辑"
                                onClick={() => edit(entry)}
                              >
                                <Pencil size={15} />
                              </button>
                              {entry.url && (
                                <a
                                  className="icon"
                                  title="打开原网站"
                                  aria-label={'打开原网站 ' + entry.title}
                                  href={entry.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ArrowUpRight size={17} />
                                </a>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="pagination">
                      <span>
                        共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 24))} 页
                      </span>
                      <button
                        aria-label="上一页"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button
                        aria-label="下一页"
                        disabled={page * 24 >= total}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <span className="empty-icon">
                      <Library size={36} />
                    </span>
                    <h2>
                      {query || domain || tag || collection
                        ? '还没有找到相关收藏'
                        : view === 'tools'
                          ? '从第一个常用工具开始'
                          : '从第一条收藏开始'}
                    </h2>
                    <p>
                      {query || domain || tag || collection
                        ? '试试其他关键词，或放宽筛选条件。'
                        : '一个好链接，一段新想法，都值得有个安放的地方。'}
                    </p>
                    <button className="primary" onClick={newEntry}>
                      <Plus size={17} />
                      {view === 'tools' ? '添加工具' : '添加收藏或笔记'}
                    </button>
                  </div>
                )}
                <footer className="page-footer">
                  个人知识收藏馆 <span>V1.7 · 本地私人知识空间</span>
                </footer>
              </>
            )}
          </div>
        </main>
      </div>
      {batchOpen && meta && (
        <BatchDialog
          meta={meta}
          count={selected.length}
          busy={actionBusy}
          onClose={() => setBatchOpen(false)}
          onApply={batch}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {previewEntry && (
        <ContentPreview
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
          onRead={() => {
            const id = previewEntry.id;
            setPreviewEntry(null);
            openContent(id);
          }}
          onEdit={() => {
            edit(previewEntry);
            setPreviewEntry(null);
          }}
          onChanged={() => {
            refresh();
            api<Entry>('/entries/' + previewEntry.id).then(setPreviewEntry);
          }}
          onOpen={(id) => {
            setPreviewEntry(null);
            openContent(id);
          }}
        />
      )}
      {sessionStorage.getItem('pk-map-return') &&
        sessionStorage.getItem('pk-map-return') !== detail?.id && (
          <button
            className="map-return"
            onClick={() => {
              const id = sessionStorage.getItem('pk-map-return');
              sessionStorage.removeItem('pk-map-return');
              if (id) void openContent(id);
            }}
          >
            ← 返回思维导图
          </button>
        )}
      {detail?.mindmap && meta && (
        <MindmapEditor
          key={detail.id}
          entry={detail}
          meta={meta}
          onChanged={() => {
            refresh();
            api<Entry>('/entries/' + detail.id).then(setDetail);
          }}
          onClose={() => {
            refresh();
            setDetail(null);
            history.replaceState(null, '', location.pathname + location.search);
            returnReadingOrigin();
          }}
          onOpen={(id) => void openContent(id)}
        />
      )}
      {detail && !detail.mindmap && (
        <ReadingSurface
          title="内容阅读"
          entry={detail}
          onEdit={() => edit(detail)}
          onChanged={() => {
            refresh();
            api<Entry>('/entries/' + detail.id).then(setDetail);
          }}
          onClose={() => {
            setDetail(null);
            history.replaceState(null, '', location.pathname + location.search);
          }}
        >
          <ReaderPanels
            id={detail.id}
            onChanged={refresh}
            source={
              <>
                <p>来源由用户保存，网址不代表已抓取或验证原文。</p>
                {detail.url && (
                  <a href={detail.url} target="_blank" rel="noopener noreferrer">
                    打开来源网址 ↗
                  </a>
                )}{' '}
                <details className="reader-metadata">
                  <summary>正文历史</summary>
                  <button
                    onClick={() =>
                      api('/entries/' + detail.id + '/versions')
                        .then(setContentHistory)
                        .catch((e) => setDetailError(e.message))
                    }
                  >
                    查看正文历史
                  </button>
                </details>
                <ContentProvenance
                  entry={detail}
                  onChanged={() => {
                    refresh();
                    api<Entry>('/entries/' + detail.id).then(setDetail);
                  }}
                  onOpen={async (id) => {
                    const e = await api<Entry>('/entries/' + id);
                    if (e.knowledge_kind) {
                      setDetail(null);
                      if (await nav('library')) setKnowledgeOpen(id);
                    } else setDetail(e);
                  }}
                />
              </>
            }
            links={
              <>
                {' '}
                <RelatedPanel
                  id={detail.id}
                  onChanged={() => {
                    refresh();
                    api<Entry>('/entries/' + detail.id).then(setDetail);
                  }}
                  onOpen={async (id) => {
                    const e = await api<Entry>('/entries/' + id);
                    if (e.knowledge_kind) {
                      setDetail(null);
                      if (await nav('library')) setKnowledgeOpen(id);
                    } else setDetail(e);
                  }}
                />
              </>
            }
            ai={<ContextAssistant entry={detail} onChanged={refresh} onOpen={openContent} />}
          >
            <div className="detail">
              {detail.type === 'bookmark' && detail.cover && <Cover entry={detail} large />}
              {detail.resource_kind === 'tool' && <Cover entry={detail} large />}
              {detail.lifecycle?.state === 'trash' && (
                <p className="draft-banner">此内容在回收站，ID、正文和归属保留。请先恢复后编辑。</p>
              )}
              <div className="detail-title">
                <div>
                  <small>{source(detail)}</small>
                  <h1>{detail.title}</h1>
                </div>
              </div>
              {detail.url && (
                <a
                  className="source-link"
                  href={detail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开原网站 <ArrowUpRight size={16} />
                </a>
              )}
              <p className="detail-description">{detail.description}</p>
              <div className="chips detail-chips">
                {detail.domains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setDetail(null);
                      setShellScope(d.id);
                    }}
                  >
                    {d.name}
                  </button>
                ))}
                {detail.tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setDetail(null);
                      nav('library').then((ok) => {
                        if (ok)
                          setLibraryScope({
                            domain: '',
                            topic: '',
                            query: '',
                            tag: t.id,
                            nonce: Date.now(),
                          });
                      });
                    }}
                  >
                    #{t.name}
                  </button>
                ))}
                {detail.collections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setDetail(null);
                      nav('all', '', c.id);
                    }}
                  >
                    <Folder size={13} />
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="note-heading">
                <FileText size={17} />
                {detail.resource_kind === 'tool'
                  ? '个人备注'
                  : detail.type === 'note'
                    ? '笔记正文'
                    : '我的批注'}
              </div>
              <div
                className="prose detail-prose"
                data-reading-id={detail.id}
                data-reading-title={detail.title}
                dangerouslySetInnerHTML={{
                  __html: detail.content || '<p>还没有笔记，点击编辑写下你的理解。</p>',
                }}
              />
              {detailError && (
                <div className="error" role="alert">
                  {detailError}
                </div>
              )}
              <div className="detail-bottom">
                <small>更新于 {new Date(detail.updated_at).toLocaleString('zh-CN')}</small>
              </div>
            </div>
          </ReaderPanels>
        </ReadingSurface>
      )}
      {contentHistory && detail && (
        <Dialog title="正文历史" onClose={() => setContentHistory(null)}>
          <p>选择旧版进入编辑器，正式正文需再次保存，不会自动覆盖。</p>
          {contentHistory.map((h) => (
            <article key={h.id}>
              <h3>{h.title}</h3>
              <small>{new Date(h.created_at).toLocaleString('zh-CN')}</small>
              <details>
                <summary>预览旧版</summary>
                <div className="prose" dangerouslySetInnerHTML={{ __html: h.content }} />
              </details>
              <button
                onClick={() => {
                  const e = detail;
                  edit(e);
                  setEditing({
                    id: e.id,
                    cover: e.cover,
                    updatedAt: e.updated_at,
                    form: {
                      ...e,
                      title: h.title,
                      description: h.description,
                      content: h.content,
                      url: e.url || '',
                      domains: e.domains.map((d) => d.id),
                      tags: e.tags.map((d) => d.id),
                      collections: e.collections.map((d) => d.id),
                    },
                  });
                  setContentHistory(null);
                }}
              >
                放入编辑器
              </button>
            </article>
          ))}
          {!contentHistory.length && <p>尚无历史版本。</p>}
        </Dialog>
      )}
      {quickOpen && meta && (
        <QuickDialog
          meta={meta}
          onPaste={() => {
            setQuickOpen(false);
            setPasteOpen(true);
          }}
          onClose={() => setQuickOpen(false)}
          onSaved={() => {
            setQuickOpen(false);
            refresh();
            notify('已保存到收集箱');
          }}
          onAdvanced={async (kind) => {
            if (kind === '思维导图') {
              try {
                const result = await createMindmap();
                setQuickOpen(false);
                refresh();
                void openContent(result.entry.id);
              } catch (e) {
                setError((e as Error).message);
              }
            } else if (kind === '统一导入') setImportGlobal(true);
            else if (kind === '综合文档') {
              setQuickOpen(false);
              await nav('library');
              setLibraryScope({ domain: '', topic: '', query: '', nonce: -Date.now() });
            } else {
              setQuickOpen(false);
              setEditing({
                form: {
                  ...blank(),
                  type: kind === '工具' ? 'note' : 'bookmark',
                  ...(kind === '工具' ? { resource_kind: 'tool', tool_kind: 'other' } : {}),
                },
              });
            }
          }}
        />
      )}
      {settingsHome && (
        <SettingsHome
          onClose={() => setSettingsHome(false)}
          onSection={(section) => {
            setSettingsHome(false);
            setSettings({ section });
          }}
          onImport={() => {
            setSettingsHome(false);
            setImportGlobal(true);
          }}
          onTrash={() => {
            setSettingsHome(false);
            setTrashOpen(true);
          }}
          onTheme={() => setDark(!dark)}
        />
      )}
      {trashOpen && (
        <TrashPanel
          revision={revision}
          onClose={() => setTrashOpen(false)}
          onChanged={refresh}
          onOpen={(id) => {
            setTrashOpen(false);
            openContent(id);
          }}
        />
      )}
      {importGlobal && <ImportDialog onClose={() => setImportGlobal(false)} onChanged={refresh} />}
      {pasteOpen && (
        <PasteImport
          meta={meta!}
          onClose={() => setPasteOpen(false)}
          onChanged={refresh}
          onOpen={openContent}
        />
      )}
      {editing && meta && (
        <EntryEditor
          initial={editing}
          embedded={editing.embedded}
          meta={meta}
          onClose={() => setEditing(null)}
          onCreated={refresh}
          onExisting={async (id) => {
            try {
              const entry = await api<Entry>('/entries/' + id);
              setDetail(entry);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onSaved={() => {
            if (editing.embedded && editing.id)
              api<Entry>('/entries/' + editing.id).then(setDetail);
            setEditing(null);
            refresh();
            notify('已保存到本地知识库');
          }}
        />
      )}
      {settings && meta && (
        <SettingsPanel
          meta={meta}
          initialSection={settings.section}
          initialKind={settings.kind}
          onClose={() => setSettings(null)}
          onRefresh={refresh}
          notify={notify}
          onImport={() => setImportGlobal(true)}
          onTrash={() => setTrashOpen(true)}
          onTheme={() => setDark(!dark)}
          onRestore={() => {
            setDetail(null);
            setEditing(null);
            nav('all');
            setQuery('');
            setTag('');
            refresh();
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
