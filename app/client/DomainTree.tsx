import { useState, type ReactNode } from 'react';
export type TreeDomain = {
  id: string;
  name: string;
  parent_id?: string | null;
  count?: number;
  position?: number;
};
export function domainOutline(
  rows: TreeDomain[],
  parent: string | null = null,
  depth = 0,
): (TreeDomain & { depth: number })[] {
  if (depth > 8) return [];
  return rows
    .filter((d) => (d.parent_id || null) === parent)
    .sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name, 'zh-CN'))
    .flatMap((d) => [{ ...d, depth }, ...domainOutline(rows, d.id, depth + 1)]);
}
export function DomainTree({
  rows,
  selected,
  onSelect,
  actions,
  folded,
  onFold,
}: {
  rows: TreeDomain[];
  selected?: string;
  onSelect: (d: TreeDomain) => void;
  actions?: (d: TreeDomain) => ReactNode;
  folded?: string[];
  onFold?: (id: string) => void;
}) {
  const [local, setLocal] = useState<string[]>([]),
    folds = folded || local;
  const toggle = (id: string) =>
    onFold
      ? onFold(id)
      : setLocal((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const render = (parent: string | null, depth = 0): ReactNode =>
    depth > 8
      ? null
      : rows
          .filter((d) => (d.parent_id || null) === parent)
          .sort(
            (a, b) =>
              (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name, 'zh-CN'),
          )
          .map((d) => {
            const branch = rows.some((c) => c.parent_id === d.id),
              open = !folds.includes(d.id);
            return (
              <div key={d.id}>
                <div
                  className={'domain-node ' + (selected === d.id ? 'selected' : '')}
                  style={{ '--depth': depth } as React.CSSProperties}
                >
                  {branch ? (
                    <button
                      className="tree-arrow"
                      aria-label={'折叠领域 ' + d.name}
                      aria-expanded={open}
                      onClick={() => toggle(d.id)}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="tree-arrow" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <button
                    className="tree-name"
                    title={d.name}
                    aria-label={'浏览领域 ' + d.name}
                    onClick={() => onSelect(d)}
                  >
                    {d.name}
                  </button>
                  <small className="tree-count">{d.count || 0}</small>
                  {actions && <div className="tree-actions">{actions(d)}</div>}
                </div>
                {open && render(d.id, depth + 1)}
              </div>
            );
          });
  return (
    <div className="domain-tree" aria-label="领域树">
      {render(null)}
    </div>
  );
}
