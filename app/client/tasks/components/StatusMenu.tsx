import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckIcon, StatusIcon } from './Icons';
import { STATUS_META, STATUS_ORDER } from '../types';
import type { TaskStatus } from '../types';

interface StatusMenuProps {
  x: number;
  y: number;
  current: TaskStatus;
  onPick: (status: TaskStatus) => void;
  onClose: () => void;
}

export default function StatusMenu({ x, y, current, onPick, onClose }: StatusMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 12);
    const top = Math.min(y, window.innerHeight - rect.height - 12);
    setPos({ left: Math.max(12, left), top: Math.max(12, top) });
  }, [x, y]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="status-menu" ref={ref} style={{ left: pos.left, top: pos.top }} role="menu">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status];
        return (
          <button
            key={status}
            type="button"
            className={`menu-item ${status === current ? 'is-active' : ''}`}
            onClick={() => onPick(status)}
          >
            <StatusIcon status={status} size={16} />
            <span>{meta.label}</span>
            {status === current && <CheckIcon size={14} className="menu-check" />}
          </button>
        );
      })}
    </div>
  );
}
