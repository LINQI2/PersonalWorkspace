import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import { RelatedPanel } from './RelatedPanel';
import { ContextAssistant } from './Experience';
import { resolveAnchor } from '../shared/reading-anchor.js';
export async function readingWrite(path: string, body: object) {
  const s = await api('/local/session');
  return api('/reading/' + path, {
    method: 'POST',
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify(body),
  });
}
async function digest(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
const text = (s: string) => s.replace(/\u00a0/g, ' ');
export function openReadingMark(mark: any) {
  sessionStorage.setItem('pk-pending-mark', mark.id);
  window.dispatchEvent(new CustomEvent('pk-reading-mark', { detail: mark }));
}
export function MarksList({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]),
    [tick, setTick] = useState(0),
    [error, setError] = useState(''),
    [edit, setEdit] = useState<any>(null),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (edit && comment !== edit.comment) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edit, comment]);
  useEffect(() => {
    let live = true;
    api('/reading/marks/' + id)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, tick]);
  useEffect(() => {
    const changed = () => setTick((n) => n + 1);
    window.addEventListener('pk-marks-changed', changed);
    return () => window.removeEventListener('pk-marks-changed', changed);
  }, []);
  const changed = () => window.dispatchEvent(new Event('pk-marks-changed'));
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
  return (
    <section className="reading-marks" aria-label="批注与摘录引用">
      <h3>
        批注与引用 <small>{rows.length}</small>
      </h3>
      {!rows.length && <p className="muted">在正文选中文字，可添加个人批注或引用到笔记。</p>}
      {rows.map((m) => (
        <article className="reading-mark" key={m.id}>
          <small>
            {m.kind === 'annotation' ? '个人批注' : '人工摘录引用'} ·{' '}
            {m.target_id === id ? '本文引用的资料' : '原文上的记录'}
          </small>
          <blockquote>{m.quote}</blockquote>
          <p>{m.comment}</p>
          <small>
            {m.sourceTitle} · {new Date(m.created_at).toLocaleString()}
          </small>
          <p className={['exact', 'relocated'].includes(m.location.state) ? 'muted' : 'error'}>
            {
              (
                {
                  exact: '原版本可定位',
                  relocated: '前后文唯一匹配，可重新定位',
                  missing: '原文已修改/删除，定位失效；原始摘录仍保留',
                  ambiguous: '存在多个相同位置，待重新关联',
                } as any
              )[m.location.state]
            }
          </p>
          <div className="mark-actions">
            <button
              disabled={!['exact', 'relocated'].includes(m.location.state)}
              onClick={() => openReadingMark(m)}
            >
              定位原文
            </button>
            {m.targetTitle && <span>引用到：{m.targetTitle}</span>}
            <button
              onClick={() => {
                setEdit(m);
                setComment(m.comment);
              }}
            >
              编辑批注
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('删除这条批注或引用？原文与已追加的引用正文仍保留。'))
                  void run(async () => {
                    await readingWrite('marks/' + m.id, {
                      revision: m.revision,
                      action: 'delete',
                      confirm: '删除这条批注或引用',
                    });
                    changed();
                  });
              }}
            >
              删除记录
            </button>
          </div>
        </article>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {edit && (
        <Dialog
          title="编辑个人批注"
          onClose={() => {
            if (!busy && (comment === edit.comment || confirm('批注尚未保存，放弃修改？')))
              setEdit(null);
          }}
        >
          <blockquote>{edit.quote}</blockquote>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <textarea
            aria-label="修改批注"
            value={comment}
            maxLength={5000}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            disabled={busy || !comment.trim()}
            onClick={() =>
              void run(async () => {
                await readingWrite('marks/' + edit.id, { revision: edit.revision, comment });
                setEdit(null);
                changed();
              })
            }
          >
            保存批注修改
          </button>
        </Dialog>
      )}
    </section>
  );
}
function makeRange(el: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
    r = document.createRange();
  let at = 0,
    node: Node | null,
    startSet = false;
  while ((node = walker.nextNode())) {
    const n = node.textContent?.length || 0;
    if (!startSet && start <= at + n) {
      r.setStart(node, Math.max(0, start - at));
      startSet = true;
    }
    if (startSet && end <= at + n) {
      r.setEnd(node, end - at);
      return r;
    }
    at += n;
  }
  return null;
}
export function ReadingTools({
  id,
  children,
  onChanged,
}: {
  id: string;
  children: ReactNode;
  onChanged: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    request = useRef(0);
  const [selection, setSelection] = useState<any>(null),
    [action, setAction] = useState(''),
    [comment, setComment] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [targets, setTargets] = useState<any[]>([]),
    [q, setQ] = useState(''),
    [target, setTarget] = useState(''),
    [title, setTitle] = useState('摘录笔记');
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (action && comment.trim()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [action, comment]);
  const select = async () => {
    if (document.querySelector('.overlay')) return;
    const seq = ++request.current,
      s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount !== 1) {
      setSelection(null);
      return;
    }
    const range = s.getRangeAt(0),
      begin = (
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement
      ) as HTMLElement,
      el = begin?.closest<HTMLElement>('.prose[data-reading-id]');
    if (
      !el ||
      !root.current?.contains(el) ||
      !el.contains(range.endContainer) ||
      el.closest('[contenteditable="true"]')
    ) {
      setSelection(null);
      return;
    }
    const quote = text(range.toString());
    if (quote.trim().length < 2 || quote.length > 2000) {
      setSelection(null);
      return;
    }
    const before = range.cloneRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length,
      hash = await digest(text(el.textContent || ''));
    if (seq !== request.current) return;
    const rect = range.getBoundingClientRect();
    setSelection({
      source_id: el.dataset.readingId,
      title: el.dataset.readingTitle || '当前内容',
      quote,
      start,
      end: start + quote.length,
      hash,
      left: Math.min(Math.max(8, rect.left), innerWidth - 320),
      top: Math.min(innerHeight - 48, Math.max(8, rect.bottom + 8)),
    });
    setError('');
  };
  useEffect(() => {
    const clear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !action) {
        if (selection) {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.getSelection()?.removeAllRanges();
        }
        setSelection(null);
        (CSS as any).highlights?.delete('pk-quote');
      }
    };
    const mouse = () => void select();
    document.addEventListener('selectionchange', mouse);
    window.addEventListener('keydown', clear, true);
    return () => {
      document.removeEventListener('selectionchange', mouse);
      window.removeEventListener('keydown', clear, true);
    };
  }, [action, selection]);
  useEffect(() => {
    if (action !== 'citation') return;
    let live = true;
    const t = setTimeout(
      () =>
        api('/reading/targets?q=' + encodeURIComponent(q))
          .then((r) => live && setTargets(r))
          .catch((e) => setError(e.message)),
      150,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, action]);
  useEffect(() => {
    let running = false,
      disposed = false;
    const locate = async () => {
      const pending = sessionStorage.getItem('pk-pending-mark');
      if (!pending || running || !root.current) return;
      running = true;
      try {
        const m = await api('/reading/mark/' + pending),
          el = root.current.querySelector<HTMLElement>('[data-reading-id="' + m.source_id + '"]');
        if (!el || disposed) return;
        const plain = text(el.textContent || ''),
          location = resolveAnchor(plain, m.anchor, await digest(plain));
        if (location.start === null) {
          setError('该摘录已无法可靠定位，原始摘录保留，请在来源面板核对。');
          sessionStorage.removeItem('pk-pending-mark');
          return;
        }
        const r = makeRange(el, location.start, location.end!);
        if (!r) return;
        const scroll = el.closest<HTMLElement>('.reading-main');
        if (scroll) {
          scroll.scrollBy({
            top: r.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 35,
            behavior: 'smooth',
          });
        }
        if ((window as any).Highlight)
          (CSS as any).highlights.set('pk-quote', new (window as any).Highlight(r));
        sessionStorage.removeItem('pk-pending-mark');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    const jump = (e: Event) => {
      const surfaces = document.querySelectorAll('.reading-surface');
      if (root.current?.closest('.reading-surface') !== surfaces.item(surfaces.length - 1)) return;
      const m = (e as CustomEvent).detail;
      if (root.current?.querySelector('[data-reading-id="' + m.source_id + '"]')) void locate();
      else if (m.pageId !== id)
        window.dispatchEvent(new CustomEvent('pk-open-mark-source', { detail: m.source_id }));
      else window.dispatchEvent(new CustomEvent('pk-expand-mark-chapter', { detail: m.source_id }));
    };
    window.addEventListener('pk-reading-mark', jump);
    const observer = new MutationObserver(() => void locate());
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    void locate();
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('pk-reading-mark', jump);
    };
  }, [id]);
  const start = (which: string) => {
    setAction(which);
    setComment('');
    setError('');
    setTarget('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await readingWrite('marks', {
        ...selection,
        kind: action,
        comment,
        target_id: target || null,
        target_title: title,
        target_version: targets.find((t) => t.id === target)?.version,
        confirm: '确认保存批注或引用',
      });
      setAction('');
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      window.dispatchEvent(new Event('pk-marks-changed'));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={root} className="reading-tools">
      {children}
      {error && !action && (
        <p role="alert" className="reading-feedback error">
          {error}
        </p>
      )}
      {selection && !action && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="原文选区操作"
          style={{ left: selection.left, top: selection.top }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(selection.quote)
                .catch(() => setError('复制失败，请使用Ctrl+C。'))
            }
          >
            复制原文
          </button>
          <button onClick={() => start('annotation')}>添加批注</button>
          <button onClick={() => start('citation')}>引用到笔记</button>
          <button onClick={() => start('relation')}>建立关联</button>
          <button
            disabled={selection.quote.length > 800}
            title="AI问题素材最多800字，请按需缩小选区"
            onClick={() => start('ai')}
          >
            上下文 AI
          </button>
          <button aria-label="关闭划词工具栏" onClick={() => setSelection(null)}>
            ×
          </button>
        </div>
      )}
      {action && selection && (
        <Dialog
          title={
            action === 'annotation'
              ? '添加个人批注'
              : action === 'citation'
                ? '摘录引用到笔记'
                : action === 'relation'
                  ? '从摘录建立关联'
                  : '选区上下文 AI'
          }
          wide
          onClose={() => {
            if (!busy && (!comment.trim() || confirm('批注尚未保存，确认关闭？'))) {
              setAction('');
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
        >
          <small>
            来源：{selection.title} · 稳定ID {selection.source_id}
          </small>
          <blockquote className="selected-excerpt">{selection.quote}</blockquote>
          <p className="muted">这是保存的原文摘录，不代表事实已验证；不自动采用AI输出。</p>
          {['annotation', 'citation'].includes(action) && (
            <>
              {action === 'citation' && (
                <>
                  <label>
                    查找已有笔记或综合文档
                    <input
                      aria-label="引用目标搜索"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="引用目标"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">新建普通笔记</option>
                    {targets
                      .filter((t) => t.id !== selection.source_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </select>
                  {!target && (
                    <input
                      aria-label="新引用笔记标题"
                      maxLength={200}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  )}
                  <p>
                    将原文、来源标题/ID及引用时间追加到
                    {target ? targets.find((t) => t.id === target)?.title : '新笔记'}
                    。保留目标旧正文和历史，不改变原文。
                  </p>
                </>
              )}
              <textarea
                aria-label="个人批注"
                placeholder={action === 'citation' ? '可选个人说明' : '写下自己的理解或待验证问题'}
                maxLength={5000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                className="primary"
                disabled={busy || (action === 'annotation' && !comment.trim())}
                onClick={() => void save()}
              >
                {busy ? '保存中…' : action === 'citation' ? '确认追加引用' : '保存个人批注'}
              </button>
            </>
          )}
          {action === 'relation' && (
            <RelatedPanel
              id={selection.source_id}
              selectionQuote={selection.quote}
              onOpen={(sourceId) =>
                window.dispatchEvent(new CustomEvent('pk-open-mark-source', { detail: sourceId }))
              }
              onChanged={onChanged}
            />
          )}
          {action === 'ai' && (
            <ContextAssistant
              entry={{ id: selection.source_id, title: selection.title }}
              initialQuestion={'请结合当前资料分析这段原文，区分资料与推断：\n' + selection.quote}
              onChanged={onChanged}
              onOpen={(sourceId) =>
                window.dispatchEvent(new CustomEvent('pk-open-mark-source', { detail: sourceId }))
              }
            />
          )}
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
