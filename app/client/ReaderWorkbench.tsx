import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type Entry } from './shared';
import { ContentActions } from './ContentActions';
import { ReadingTools, MarksList } from './ReadingTools';
export function ReaderToolbar({
  title,
  onBack,
  onEdit,
  entry,
  onChanged,
  children,
}: {
  title: string;
  onBack: () => void;
  onEdit?: () => void;
  entry?: Entry;
  onChanged?: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.getBoundingClientRect().height)
        el.closest<HTMLElement>('.reading-surface')?.style.setProperty(
          '--reader-bar-height',
          el.getBoundingClientRect().height + 'px',
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <header ref={ref} className="reader-toolbar" aria-label="阅读固定操作区">
      <button onClick={onBack}>← 返回列表</button>
      <strong title={title}>{title}</strong>
      {entry?.lifecycle?.state === 'trash' && (
        <small className="reader-trash-state">回收站 · 可恢复</small>
      )}
      {children}
      {onEdit && entry?.lifecycle?.state !== 'trash' && <button onClick={onEdit}>编辑</button>}
      {entry && <ContentActions entry={entry} onChanged={onChanged || (() => {})} />}
      {history.state?.fromReading && <button onClick={() => history.back()}>返回上一内容</button>}
    </header>
  );
}
export function ReaderPanels({
  id,
  source,
  links,
  ai,
  children,
  onPanelChange,
  outline,
  outlineClosed,
  onOutlineChange,
  onChanged,
}: {
  id: string;
  source: ReactNode;
  links: ReactNode;
  ai: ReactNode;
  children: ReactNode;
  onPanelChange?: (open: boolean) => void;
  outline?: ReactNode;
  outlineClosed?: boolean;
  onOutlineChange?: (closed: boolean) => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('pk-reader-panel-' + id) || ''),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTab(sessionStorage.getItem('pk-reader-panel-' + id) || '');
  }, [id]);
  const choose = (v: string) => {
    setTab(v);
    sessionStorage.setItem('pk-reader-panel-' + id, v);
  };
  useEffect(() => {
    onPanelChange?.(!!tab);
  }, [tab]);
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('.reading-main');
    if (!el) return;
    const key = 'pk-reader-scroll-' + id,
      restore = requestAnimationFrame(
        () => (el.scrollTop = Number(sessionStorage.getItem(key)) || 0),
      );
    const save = () => sessionStorage.setItem(key, String(el.scrollTop));
    el.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(restore);
      save();
      el.removeEventListener('scroll', save);
    };
  }, [id]);
  useEffect(() => {
    const toggle = (e: Event) => {
      if ((e as CustomEvent).detail && (e as CustomEvent).detail !== id) return;
      choose(tab ? '' : 'source');
    };
    window.addEventListener('pk-reader-toggle', toggle);
    const close = (e: Event) => {
      if ((e as CustomEvent).detail && (e as CustomEvent).detail !== id) return;
      choose('');
    };
    window.addEventListener('pk-reader-aux-close', close);
    const key = (e: KeyboardEvent) => {
      const surfaces = document.querySelectorAll('.reading-surface');
      if (root.current?.closest('.reading-surface') !== surfaces.item(surfaces.length - 1)) return;
      if (e.key === 'Escape' && tab && !document.querySelector('.overlay')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        choose('');
        root.current?.querySelector<HTMLButtonElement>('.reader-panel-tabs button')?.focus();
      } else if (
        e.key === 'Escape' &&
        outline &&
        !outlineClosed &&
        !document.querySelector('.overlay')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOutlineChange?.(true);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('pk-reader-toggle', toggle);
      window.removeEventListener('pk-reader-aux-close', close);
    };
  }, [tab, id, outlineClosed, outline]);
  const tabs = (
    <div className="reader-panel-tabs" role="tablist" aria-label="阅读辅助面板">
      {[
        ['source', '来源与历史'],
        ['links', '知识关联'],
        ['ai', '上下文 AI'],
      ].map(([k, label]) => (
        <button role="tab" key={k} aria-selected={tab === k} onClick={() => choose(k)}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div
      ref={root}
      data-reader-id={id}
      className={
        'reader-workbench ' +
        (tab ? 'has-aux ' : '') +
        (outline && !outlineClosed ? 'has-outline' : '')
      }
    >
      {outline && outlineClosed && (
        <button
          className="reader-edge reader-edge-left"
          aria-label="展开章节大纲"
          onClick={() => onOutlineChange?.(false)}
        >
          ☰ 大纲
        </button>
      )}
      {!tab && (
        <button
          className="reader-edge reader-edge-right"
          aria-label="展开辅助信息"
          onClick={() => choose('source')}
        >
          来源 · 关联 ›
        </button>
      )}
      <div className="reading-columns">
        {outline && !outlineClosed && (
          <aside className="reader-left" aria-label="左侧阅读大纲">
            <div className="reader-aux-head">
              <strong>章节大纲</strong>
              <button aria-label="收起章节大纲" onClick={() => onOutlineChange?.(true)}>
                ‹
              </button>
            </div>
            {outline}
          </aside>
        )}
        <div className="reading-main" tabIndex={0} aria-label="正文阅读区域">
          <ReadingTools id={id} onChanged={onChanged || (() => {})}>
            {children}
          </ReadingTools>
        </div>
        {tab && (
          <aside className="reader-aux" aria-label="阅读辅助信息">
            <div className="reader-aux-head">
              <strong>
                {tab === 'source' ? '来源与引用' : tab === 'links' ? '知识关联' : '上下文 AI'}
              </strong>
              <button aria-label="关闭辅助面板" onClick={() => choose('')}>
                ×
              </button>
            </div>
            {tabs}
            <div className="reader-aux-body">
              {tab === 'source' ? (
                <>
                  {source}
                  <MarksList id={id} />
                </>
              ) : tab === 'links' ? (
                links
              ) : (
                ai
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
