import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from './useScrollLock';
import { FileText, X, BookOpen, Code2, Palette, Compass, Shapes, Bookmark } from 'lucide-react';
import { type Entry, toolLabels } from './shared';
export function source(entry: Entry) {
  if (entry.resource_kind === 'tool')
    return toolLabels[entry.tool_kind as keyof typeof toolLabels] || '工具';
  if (entry.type === 'note') return entry.provenance?.record ? '导入笔记' : '笔记';
  try {
    return new URL(entry.url!).hostname.replace(/^www\./, '');
  } catch {
    return '网址收藏';
  }
}
function coverHue(text: string) {
  let n = 0;
  for (const c of text) n = (n * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(n * 137.508) % 360;
}
export function Cover({
  entry,
  large = false,
}: {
  entry: Pick<Entry, 'domains' | 'type' | 'resource_kind' | 'tool_kind' | 'cover'>;
  large?: boolean;
}) {
  if (entry.resource_kind === 'tool')
    return (
      <div className={'tool-icon ' + (large ? 'tool-icon-large' : '')}>
        {entry.cover ? (
          <img src={'/assets/' + entry.cover} alt="工具图标" />
        ) : (
          React.createElement(
            [Compass, Code2, Shapes, BookOpen, Palette, Bookmark][
              Math.max(0, Object.keys(toolLabels).indexOf(entry.tool_kind || ''))
            ],
          )
        )}
      </div>
    );
  const text = entry.domains[0]?.name || (entry.type === 'note' ? '我的思考' : '等待发现');
  let hash = 0;
  for (const c of text) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return (
    <div
      style={{ '--hue': coverHue(text) } as React.CSSProperties}
      className={'cover ' + (large ? 'large ' : '') + 'tone-' + Math.abs(hash % 5)}
    >
      {entry.cover ? (
        <img src={'/assets/' + entry.cover} alt="封面" />
      ) : (
        <>
          <div className="cover-orbit" />
          <div className="cover-symbol">
            {React.createElement(
              entry.type === 'note'
                ? FileText
                : [Code2, Palette, Compass, Shapes, BookOpen, Bookmark][Math.abs(hash) % 6],
            )}
          </div>
          <span className="cover-kind">{entry.type === 'note' ? '原创笔记' : '网址收藏'}</span>
          <span className="cover-label">{text}</span>
          <span className="cover-mini">PERSONAL COLLECTION</span>
        </>
      )}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement;
    const preferred = ref.current?.querySelector<HTMLElement>(
      'input[aria-label="网址"],input[aria-label="标题"]',
    );
    (preferred || ref.current)?.focus();
    const listener = (e: KeyboardEvent) => {
      if (
        document
          .querySelectorAll('.overlay')
          .item(document.querySelectorAll('.overlay').length - 1)
          ?.contains(ref.current) === false
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[contenteditable="true"]',
          ) || [],
        ).filter((node) => node.getClientRects().length > 0);
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      before?.focus();
    };
  }, []);
  return createPortal(
    <div className="overlay">
      <div
        ref={ref}
        tabIndex={-1}
        className={'dialog ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
