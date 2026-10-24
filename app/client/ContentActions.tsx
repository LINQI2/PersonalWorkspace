import { useEffect, useRef, useState } from 'react';
import { Pin, MoreHorizontal } from 'lucide-react';
import { api, type Entry } from './shared';
export async function contentAction(id: string, action: string, updated_at?: string) {
  const session = await api('/local/session');
  return api('/content/' + id + '/action', {
    method: 'POST',
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify({
      action,
      updated_at,
      confirm: action === 'trash' ? '移入回收站' : undefined,
    }),
  });
}
export function ContentActions({
  entry,
  onChanged,
  onEdit,
  onPreview,
}: {
  entry: Entry;
  onChanged: () => void;
  onEdit?: () => void;
  onPreview?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="content-actions">
      <button
        className={'pin-toggle ' + (entry.pinned ? 'is-pinned' : '')}
        disabled={busy}
        aria-pressed={!!entry.pinned}
        aria-label={(entry.pinned ? '取消置顶 ' : '置顶 ') + entry.title}
        title={entry.pinned ? '取消置顶' : '置顶'}
        onClick={() =>
          run(() =>
            api('/entries/' + entry.id + '/pin', {
              method: 'PATCH',
              body: JSON.stringify({ pinned: !entry.pinned }),
            }),
          )
        }
      >
        <Pin size={16} />
        <span>{entry.pinned ? '已置顶' : '置顶'}</span>
      </button>
      {onPreview && <button onClick={onPreview}>预览</button>}
      <details
        ref={menu}
        className="action-menu"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeMenu();
          }
        }}
      >
        <summary aria-label={'更多操作 ' + entry.title}>
          <MoreHorizontal size={19} />
        </summary>
        <div>
          {onEdit && (
            <button
              onClick={() => {
                closeMenu();
                onEdit();
              }}
            >
              编辑 / 移动归属
            </button>
          )}
          <a href={'/#content-' + entry.id} target="_blank" rel="noopener noreferrer">
            新标签页阅读
          </a>
          {entry.lifecycle?.state === 'trash' ? (
            <button
              disabled={busy}
              onClick={() => run(() => contentAction(entry.id, 'restore', entry.updated_at))}
            >
              恢复内容
            </button>
          ) : (
            <button
              className="danger-text"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    '将「' +
                      entry.title +
                      '」移入回收站？ID、正文、来源和附件保留；有明确引用或子章节时会安全拒绝。',
                  )
                )
                  run(() => contentAction(entry.id, 'trash', entry.updated_at));
              }}
            >
              移入回收站
            </button>
          )}
        </div>
      </details>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
