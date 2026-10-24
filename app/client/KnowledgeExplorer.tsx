import { useEffect, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import { relationLabels, relationWrite } from './RelatedPanel';
const typeLabels: Record<string, string> = {
  mindmap: '思维导图',
  note: '笔记',
  bookmark: '网站收藏',
  tool: '工具',
  document: '综合文档',
  block: '章节',
};
const colors: Record<string, string> = {
  reference: '#4687b5',
  complement: '#348b72',
  conflict: '#be6666',
  revision: '#ac8543',
  dependency: '#8771b8',
  composition: '#708890',
  related: '#62966d',
};
export function KnowledgeExplorer({
  initial = '',
  onClose,
  onOpen,
}: {
  initial?: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [center, setCenter] = useState(initial),
    [q, setQ] = useState(''),
    [choices, setChoices] = useState<any[]>([]),
    [map, setMap] = useState<any>(null),
    [depth, setDepth] = useState(1),
    [types, setTypes] = useState<string[]>([]),
    [candidates, setCandidates] = useState(false),
    [list, setList] = useState(false),
    [error, setError] = useState(''),
    [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        api('/relation-candidates?' + new URLSearchParams({ q })).then(
          (r) => live && setChoices(r),
        ),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  useEffect(() => {
    if (!center) return;
    let live = true;
    relationWrite('graph', { id: center, depth, types, candidates })
      .then((r) => live && setMap(r))
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [center, depth, types, candidates]);
  const open = (id: string) => {
    onClose();
    onOpen(id);
  };
  return (
    <Dialog title="知识探索 · 局部知识地图" wide onClose={onClose}>
      <div className="knowledge-explorer">
        <p>只查看真实站内对象及现有连线，一层或两层；未确认候选默认隐藏。</p>
        <input
          aria-label="搜索地图中心"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索内容或章节"
        />
        <select aria-label="地图中心" value={center} onChange={(e) => setCenter(e.target.value)}>
          <option value="">请选择中心对象</option>
          {[...(map?.nodes || []), ...choices]
            .filter((r, i, rows) => rows.findIndex((x) => x.id === r.id) === i)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {typeLabels[r.type] || r.type}
              </option>
            ))}
        </select>
        <div className="knowledge-actions">
          <select
            aria-label="地图层数"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            <option value={1}>一层直接关系</option>
            <option value={2}>两层关系</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={candidates}
              onChange={(e) => setCandidates(e.target.checked)}
            />
            显示待确认候选
          </label>
          <button onClick={() => setList(!list)}>{list ? '切换地图' : '切换列表'}</button>
        </div>
        <div className="choice-wrap">
          {Object.entries(relationLabels).map(([k, v]) => (
            <label key={k} style={{ borderLeft: '3px solid ' + colors[k], paddingLeft: 5 }}>
              <input
                type="checkbox"
                aria-label={'地图关系 ' + v}
                checked={types.includes(k)}
                onChange={() =>
                  setTypes((ts) => (ts.includes(k) ? ts.filter((t) => t !== k) : [...ts, k]))
                }
              />
              {v}
            </label>
          ))}
        </div>
        <p className="muted">未勾选类型表示全部类型。连线箭头从A指向B，完整方向说明在下方列表。</p>
        {map && (
          <>
            <p>
              {map.nodes.length}节点 / {map.edges.length}连线；上限省略计数{map.omitted}。
              {map.notice}
            </p>
            {!list && (
              <svg
                viewBox="0 0 900 650"
                className="knowledge-map"
                role="group"
                aria-label="局部知识关系图"
              >
                <defs>
                  <marker
                    id="relation-arrow"
                    markerWidth="7"
                    markerHeight="7"
                    refX="25"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                  </marker>
                </defs>
                {map.edges.map((e: any) => {
                  const position = (id: string) => {
                    const n = map.nodes.findIndex((r: any) => r.id === id);
                    return n === 0
                      ? [450, 325]
                      : [
                          450 + 300 * Math.cos(((n - 1) * 2 * Math.PI) / (map.nodes.length - 1)),
                          325 + 245 * Math.sin(((n - 1) * 2 * Math.PI) / (map.nodes.length - 1)),
                        ];
                  };
                  const a = position(e.from_id),
                    b = position(e.to_id);
                  return (
                    <g key={e.id}>
                      <line
                        x1={a[0]}
                        y1={a[1]}
                        x2={b[0]}
                        y2={b[1]}
                        stroke={colors[e.type]}
                        opacity={e.state === 'candidate' ? 0.25 : 0.55}
                        markerEnd="url(#relation-arrow)"
                      />
                      <title>
                        {map.nodes.find((r: any) => r.id === e.from_id)?.title} →{' '}
                        {map.nodes.find((r: any) => r.id === e.to_id)?.title} ·{' '}
                        {relationLabels[e.type]} · {e.note}
                      </title>
                    </g>
                  );
                })}
                {map.nodes.map((r: any, n: number) => {
                  const x =
                      n === 0
                        ? 450
                        : 450 + 300 * Math.cos(((n - 1) * 2 * Math.PI) / (map.nodes.length - 1)),
                    y =
                      n === 0
                        ? 325
                        : 325 + 245 * Math.sin(((n - 1) * 2 * Math.PI) / (map.nodes.length - 1));
                  return (
                    <g
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      aria-label={'地图节点 ' + r.title}
                      onClick={() => open(r.id)}
                      onKeyDown={(e) => {
                        if (['Enter', ' '].includes(e.key)) {
                          e.preventDefault();
                          open(r.id);
                        }
                      }}
                    >
                      <circle
                        cx={x}
                        cy={y}
                        r={n === 0 ? 30 : 20}
                        fill="var(--panel)"
                        stroke="var(--accent)"
                        strokeWidth={n === 0 ? 3 : 1}
                      />
                      <text x={x} y={y + 40} textAnchor="middle" fill="currentColor">
                        {r.title.length > 14 ? r.title.slice(0, 14) + '…' : r.title}
                      </text>
                      <title>
                        {r.title} · {typeLabels[r.type] || r.type}
                      </title>
                    </g>
                  );
                })}
              </svg>
            )}
            <section className="map-list">
              <h3>可访问的节点与方向列表</h3>
              {map.nodes.map((r: any) => (
                <button key={r.id} onClick={() => open(r.id)}>
                  {r.title} · {typeLabels[r.type] || r.type}
                  {r.anchor ? ' · 章节' : ''}
                </button>
              ))}
              {map.edges.map((e: any) => (
                <p key={e.id}>
                  {map.nodes.find((r: any) => r.id === e.from_id)?.title} →{' '}
                  {map.nodes.find((r: any) => r.id === e.to_id)?.title} · {relationLabels[e.type]} ·{' '}
                  {e.state === 'candidate' ? '待确认' : '已确认'} · {e.note}
                </p>
              ))}
            </section>
          </>
        )}
        <button onClick={() => api('/relation-history').then(setHistory)}>查看关联历史</button>
        {history.map((h) => (
          <p key={h.id}>
            {new Date(h.created_at).toLocaleString()}{' '}
            <button
              onClick={async () => {
                if (!confirm('恢复此关联批次？后续内容或关系已变化时会拒绝。')) return;
                try {
                  await relationWrite('restore', { id: h.id, confirm: '恢复关联历史' });
                  setCenter('');
                  setMap(null);
                  setHistory([]);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              恢复此批次
            </button>
          </p>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
