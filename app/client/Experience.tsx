import { returnReadingOrigin } from './readingNavigation';
import { ContentActions, contentAction } from './ContentActions';
export { ContentActions, contentAction } from './ContentActions';
import {
  useQuickDraft,
  initQuickDraft,
  updateQuickDraft,
  captureQuickDraft,
  settleQuickDraft,
} from './quickDraft';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Assistant } from './Assistant';
import { api, type Entry, type Meta } from './shared';
import { Dialog } from './components';
import { useScrollLock } from './useScrollLock';
import { ReaderToolbar } from './ReaderWorkbench';
import { UnifiedImport } from './UnifiedImport';
import {
  Pin,
  MoreHorizontal,
  ArrowUpRight,
  FileText,
  Bookmark,
  Wrench,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
export const contentKind = (e: Entry) =>
  e.mindmap
    ? '思维导图'
    : e.resource_kind === 'tool'
      ? '工具'
      : e.knowledge_kind === 'page'
        ? '综合文档'
        : e.type === 'bookmark'
          ? '网站收藏'
          : '笔记';
export function QuickRecord({
  meta,
  onSaved,
  onAdvanced,
  compact = false,
  onDirty,
}: {
  meta: Meta;
  onSaved: () => void;
  onAdvanced?: (kind: string) => void;
  compact?: boolean;
  onDirty?: (value: boolean) => void;
}) {
  const draft = useQuickDraft(),
    { text, title, domain, tag } = draft;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => initQuickDraft(meta.dataPath), [meta.dataPath]);
  useEffect(() => onDirty?.(!!(text || title || domain || tag)), [text, title, domain, tag]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (text || title || domain || tag) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [text, title, domain, tag]);
  return (
    <form
      className={'quick-record ' + (compact ? 'compact' : '')}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await captureQuickDraft();
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || !draft.loaded}>
        <label className="sr-only" htmlFor={compact ? 'quick-inline' : 'quick-dialog'}>
          快速记录正文
        </label>
        <textarea
          id={compact ? 'quick-inline' : 'quick-dialog'}
          aria-label="快速记录正文"
          placeholder="记下一条灵感，或粘贴链接…"
          maxLength={20000}
          value={text}
          onChange={(e) => updateQuickDraft({ text: e.target.value })}
          disabled={!draft.loaded || busy}
          rows={compact ? 2 : 5}
        />
        <div className="quick-footer">
          <small>保存到收集箱 · 分类可稍后整理</small>
          <button
            className="primary"
            disabled={!draft.loaded || draft.conflict || !text.trim() || busy}
          >
            {busy ? '保存中…' : '保存记录'}
          </button>
        </div>
        <details>
          <summary>可选标题与分类</summary>
          <input
            aria-label="快速记录标题"
            placeholder="标题（可选）"
            value={title}
            maxLength={200}
            onChange={(e) => updateQuickDraft({ title: e.target.value })}
          />
          <select
            aria-label="快速记录领域"
            value={domain}
            onChange={(e) => updateQuickDraft({ domain: e.target.value })}
          >
            <option value="">稍后选择领域</option>
            {meta.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            aria-label="快速记录标签"
            value={tag}
            onChange={(e) => updateQuickDraft({ tag: e.target.value })}
          >
            <option value="">稍后添加标签</option>
            {meta.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </details>
        {onAdvanced && (
          <div className="secondary-create">
            {['网站收藏', '工具', '综合文档', '思维导图', '统一导入'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (
                    !(text || title || domain || tag) ||
                    confirm('当前快速记录尚未保存；完整表单不会自动采用这些文字。确认切换？')
                  )
                    onAdvanced(k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        <small role="status">{draft.status}</small>
        {(error || draft.error) && (
          <p className="error" role="alert">
            {error || draft.error}
          </p>
        )}
        {draft.conflict && (
          <div>
            <button
              type="button"
              onClick={() => {
                if (confirm('放弃当前输入并载入服务端草稿？')) settleQuickDraft('remote');
              }}
            >
              载入服务端草稿
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('确认用当前输入替换服务端临时草稿？正式内容不变。'))
                  settleQuickDraft('local');
              }}
            >
              保留当前输入
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
export function QuickDialog(props: {
  onPaste?: () => void;
  meta: Meta;
  onSaved: () => void;
  onClose: () => void;
  onAdvanced: (kind: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <Dialog
      title="快速记录"
      onClose={() => {
        if (!dirty || confirm('记录尚未保存，确认关闭？')) props.onClose();
      }}
    >
      <div>
        {props.onPaste && <button onClick={props.onPaste}>粘贴文字 / Markdown</button>}
        <QuickRecord
          meta={props.meta}
          onDirty={setDirty}
          onSaved={() => {
            setDirty(false);
            props.onSaved();
          }}
          onAdvanced={props.onAdvanced}
        />
      </div>
    </Dialog>
  );
}
export function ReadingSurface({
  children,
  title,
  onClose,
  entry,
  onEdit,
  onChanged,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  entry?: Entry;
  onEdit?: () => void;
  onChanged?: () => void;
}) {
  const [scroll] = useState(() => window.scrollY);
  const close = () => {
    onClose();
    if (entry) returnReadingOrigin();
  };
  useScrollLock();
  useEffect(() => {
    return () => {
      window.scrollTo(0, scroll);
    };
  }, [scroll]);
  return (
    <section
      className="reading-surface"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (document.querySelector('.overlay')) return;
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="reading-back">
        <ReaderToolbar
          title={entry?.title || title}
          onBack={close}
          entry={entry}
          onEdit={onEdit}
          onChanged={onChanged}
        />
      </div>
      {children}
    </section>
  );
}
function MiniRow({
  entry,
  onOpen,
  onChanged,
  onEdit,
}: {
  entry: Entry;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onEdit?: (e: Entry) => void;
}) {
  const Icon =
    entry.resource_kind === 'tool'
      ? Wrench
      : entry.knowledge_kind === 'page'
        ? BookOpen
        : entry.type === 'bookmark'
          ? Bookmark
          : FileText;
  return (
    <article className="task-row">
      <span className="type-icon">
        <Icon size={19} />
      </span>
      <div>
        <a
          href={'#content-' + entry.id}
          onClick={(e) => {
            e.preventDefault();
            onOpen(entry.id);
          }}
        >
          {entry.title}
        </a>
        <small>
          {contentKind(entry)} · {entry.domains.map((d) => d.name).join(' / ') || '未归属领域'}
        </small>
      </div>
      <ContentActions
        entry={entry}
        onChanged={onChanged}
        onEdit={onEdit ? () => onEdit(entry) : undefined}
      />
    </article>
  );
}
export function Workbench({
  meta,
  revision,
  onOpen,
  onChanged,
  onInbox,
  onEdit,
}: {
  meta: Meta;
  revision: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onInbox: () => void;
  onEdit: (e: Entry) => void;
}) {
  const [recent, setRecent] = useState<Entry[]>([]),
    [pending, setPending] = useState(0),
    [resume, setResume] = useState<Entry | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      api('/entries?library=1&sort=updated'),
      api('/entries?library=1&view=inbox'),
    ]).then(([r, p]) => {
      if (live) {
        setRecent(r.items.slice(0, 6));
        setPending(p.total);
      }
    });
    const id = sessionStorage.getItem('pk-last-read');
    if (id)
      api('/entries/' + id)
        .then((e) => {
          if (live && e.lifecycle?.state !== 'trash') setResume(e);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <div className="workbench">
      <div className="page-heading">
        <small>我的知识空间</small>
        <h1>把想法留下，让知识相连。</h1>
        <p>先记录，再整理。随时回到自己的思考与资料。</p>
      </div>
      <div className="workbench-top">
        <section className="surface">
          <h2>快速记录</h2>
          <QuickRecord meta={meta} compact onSaved={onChanged} />
        </section>
        <section className="surface task-summary">
          <h2>待处理</h2>
          <strong>{pending}</strong>
          <p>条记录等待整理，内容已经安全保存。</p>
          <button onClick={onInbox}>
            打开收集箱 <ChevronRight size={16} />
          </button>
          {resume && (
            <div className="resume">
              <h3>继续阅读</h3>
              <button onClick={() => onOpen(resume.id)}>{resume.title} ↗</button>
              <small>上次在此浏览器打开的内容</small>
            </div>
          )}
        </section>
      </div>
      <section className="surface">
        <h2>最近更新</h2>
        {recent.map((e) => (
          <MiniRow key={e.id} entry={e} onOpen={onOpen} onChanged={onChanged} onEdit={onEdit} />
        ))}
        {!recent.length && <p className="muted">保存第一条记录，开始积累自己的知识。</p>}
      </section>
    </div>
  );
}
export function InboxPage({
  meta,
  revision,
  onOpen,
  onEdit,
  onChanged,
}: {
  meta: Meta;
  revision: number;
  onOpen: (id: string) => void;
  onEdit: (e: Entry) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Entry[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    api('/entries?library=1&view=inbox&sort=recent&page=' + page)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  }, [revision, page]);
  return (
    <div className="inbox-page">
      <div className="page-heading">
        <h1>
          收集箱 <small>{total}</small>
        </h1>
        <p>灵感先收下，分类和判断留给下一步。</p>
      </div>
      <QuickRecord compact meta={meta} onSaved={onChanged} />
      <section className="surface inbox-queue">
        <h2>待处理队列</h2>
        {items.map((e) => (
          <div key={e.id}>
            <MiniRow entry={e} onOpen={onOpen} onChanged={onChanged} onEdit={onEdit} />
            <div className="inbox-operations">
              <button onClick={() => onEdit(e)}>整理</button>
              <button
                onClick={() =>
                  contentAction(e.id, 'done', e.updated_at)
                    .then(onChanged)
                    .catch((e) => setError(e.message))
                }
              >
                完成处理
              </button>
              <button
                onClick={() =>
                  contentAction(e.id, 'later', e.updated_at)
                    .then(onChanged)
                    .catch((e) => setError(e.message))
                }
              >
                {e.lifecycle?.state === 'later' ? '已标记稍后' : '稍后处理'}
              </button>
            </div>
          </div>
        ))}
        {!items.length && <p className="muted">暂无待处理记录。</p>}
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / 24))}
          </span>
          <button disabled={page * 24 >= total} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export function TrashPanel({
  revision,
  onClose,
  onChanged,
  onOpen,
}: {
  revision: number;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<Entry[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    api('/entries?view=trash&library=1&page=' + page)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        if (page > Math.max(1, Math.ceil(r.total / 24)))
          setPage(Math.max(1, Math.ceil(r.total / 24)));
      })
      .catch((e) => setError(e.message));
  }, [revision, page]);
  return (
    <Dialog title="回收站" wide onClose={onClose}>
      <p className="muted">仅隐藏内容，ID、正文、来源、附件和关系保留。这里不提供永久清空。</p>
      {items.map((e) => (
        <MiniRow key={e.id} entry={e} onOpen={onOpen} onChanged={onChanged} />
      ))}
      {!items.length && <p>回收站为空。</p>}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          上一页
        </button>
        <span>
          {page} / {Math.max(1, Math.ceil(total / 24))}
        </span>
        <button disabled={page * 24 >= total} onClick={() => setPage((p) => p + 1)}>
          下一页
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
export function SettingsHome({
  onClose,
  onSection,
  onImport,
  onTrash,
  onTheme,
}: {
  onClose: () => void;
  onSection: (s: any) => void;
  onImport: () => void;
  onTrash: () => void;
  onTheme: () => void;
}) {
  return (
    <Dialog title="设置" wide onClose={onClose}>
      <div className="settings-overview">
        {[
          ['数据与备份', '导出 ZIP、恢复、草稿与完整性', 'backup'],
          ['AI 服务', 'DeepSeek / OpenAI、安全密钥与用量', 'ai'],
          ['分类管理', '领域、子领域、专题与标签', 'classification'],
          ['网站启停', '正常停止、实例状态', 'service'],
        ].map(([t, d, k]) => (
          <button key={k} onClick={() => onSection(k)}>
            <strong>{t}</strong>
            <small>{d}</small>
            <ChevronRight />
          </button>
        ))}
        <button onClick={onImport}>
          <strong>导入与交换</strong>
          <small>JSON v1 / v2、人工预览审核</small>
          <ChevronRight />
        </button>
        <button onClick={onTrash}>
          <strong>回收站</strong>
          <small>恢复原 ID 与归属</small>
          <ChevronRight />
        </button>
        <button onClick={onTheme}>
          <strong>界面偏好</strong>
          <small>切换明暗主题；侧栏可由顶栏收起</small>
          <ChevronRight />
        </button>
      </div>
    </Dialog>
  );
}
export function ImportDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <UnifiedImport
      onClose={onClose}
      onImported={() => {
        onChanged();
        onClose();
      }}
    />
  );
}
export function ContextAssistant({
  entry,
  onChanged,
  onOpen,
  initialQuestion,
}: {
  initialQuestion?: string;
  entry: { id: string; title: string };
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    leave = useRef<(() => Promise<boolean>) | undefined>(undefined);
  return (
    <>
      <button onClick={() => setOpen(true)}>就此内容询问 AI</button>
      {open && (
        <Dialog
          title={'上下文 AI · ' + entry.title}
          wide
          onClose={async () => {
            if (!leave.current || (await leave.current())) setOpen(false);
          }}
        >
          <p className="muted">
            默认只选择当前内容作为证据。可调整范围、查看费用，再主动生成；不会自动保存回答。
          </p>
          <Assistant
            initialContext={'entries:' + entry.id}
            initialQuestion={initialQuestion}
            onChanged={onChanged}
            registerLeave={(fn) => {
              leave.current = fn;
            }}
            onOpen={async (key) => {
              if (leave.current && !(await leave.current())) return;
              const [kind, id] = key.split(':');
              if (kind === 'entries') {
                setOpen(false);
                onOpen(id);
              }
            }}
          />
        </Dialog>
      )}
    </>
  );
}
