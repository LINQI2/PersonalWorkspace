import { useEffect, useRef } from 'react';
export function FilterMenu({
  label,
  value,
  options,
  open,
  onOpen,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    root.current
      ?.querySelector<HTMLButtonElement>('.filter-options button[aria-pressed="true"]')
      ?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div ref={root} className="filter-popover">
      <button
        ref={trigger}
        className="filter-trigger"
        aria-label={label + '筛选'}
        aria-expanded={open}
        aria-controls={'filter-' + label}
        onClick={() => onOpen(!open)}
      >
        {label} {value ? '· 已选' : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div
          className="filter-options"
          id={'filter-' + label}
          role="group"
          aria-label={label + '可选值'}
        >
          {[{ id: '', name: '全部' + label }, ...options].map((o) => (
            <button
              key={o.id}
              aria-pressed={value === o.id}
              onClick={() => {
                onChange(o.id);
                onOpen(false);
                trigger.current?.focus();
              }}
            >
              {o.name}
            </button>
          ))}
          {!options.length && <p className="muted">尚无可选{label}</p>}
        </div>
      )}
    </div>
  );
}
