import { useEffect, useRef, useState } from 'react';
import MindElixir from 'mind-elixir';
import 'mind-elixir/style.css';
import { api, type Entry, type Meta } from './shared';
import { Dialog } from './components';
import { useScrollLock } from './useScrollLock';
import { validateMap, mapNodes, mapMarkdown, mapFormat, newMap } from '../shared/mindmap.js';
import { ContentActions } from './ContentActions';
import { exportMindmap } from './mindmapExport';
import './mindmap.css';
type Snapshot = {
  title: string;
  data: any;
  domains: string[];
  tags: string[];
  collections: string[];
  primary_domain_id: string | null;
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const mapTheme = (appearance: string) => ({
  ...(appearance === 'dark' ? MindElixir.DARK_THEME : MindElixir.THEME),
  palette: ['#647eaa', '#789b8b', '#bc9971', '#a084a8'],
  cssVar: {
    ...(appearance === 'dark' ? MindElixir.DARK_THEME : MindElixir.THEME).cssVar,
    '--root-bgcolor': '#344e68',
    '--root-color': '#ffffff',
    '--selected': '#588b9d',
  },
});
export async function mapWrite(path: string, method: string, body: any) {
  const session = await api('/local/session');
  return api('/' + path, {
    method,
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify(body),
  });
}
export function downloadMap(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function MindmapEditor({
  entry,
  meta,
  onClose,
  onOpen,
  onChanged,
}: {
  entry: Entry;
  meta: Meta;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  useScrollLock();
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<MindElixir | null>(null),
    current = useRef<Snapshot | null>(null),
    revision = useRef(0),
    saved = useRef(''),
    undo = useRef<Snapshot[]>([]),
    redo = useRef<Snapshot[]>([]),
    loading = useRef(false),
    saving = useRef(false),
    blocked = useRef(false),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stamp = useRef('');
  const readOnly = useRef(false);
  readOnly.current = entry.lifecycle?.state === 'trash';
  const [snap, setSnap] = useState<Snapshot | null>(null),
    [status, setStatus] = useState('正在打开…'),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [outline, setOutline] = useState(false),
    [panel, setPanel] = useState(false),
    [linkSearch, setLinkSearch] = useState(''),
    [results, setResults] = useState<Entry[]>([]),
    [linked, setLinked] = useState<any[]>([]),
    [target, setTarget] = useState(''),
    [label, setLabel] = useState(''),
    [both, setBoth] = useState(false),
    [nodeText, setNodeText] = useState(''),
    [find, setFind] = useState(''),
    [recovery, setRecovery] = useState<any>(null),
    [historyRows, setHistoryRows] = useState<any[] | null>(null),
    [imported, setImported] = useState<any>(null);
  const windowId = useRef(sessionStorage.getItem('pk-map-window') || crypto.randomUUID());
  sessionStorage.setItem('pk-map-window', windowId.current);
  const prefix = 'pk-map-recovery:' + meta.dataPath + ':' + entry.id + ':',
    journal = prefix + windowId.current;
  const writeJournal = () => {
    try {
      localStorage.setItem(
        journal,
        JSON.stringify({
          base: revision.current,
          stamp: stamp.current,
          payload: current.current,
          at: Date.now(),
        }),
      );
    } catch {
      setError('浏览器恢复副本写入失败，请立即保存或导出JSON。');
    }
  };
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 650);
  };
  const flush = async (): Promise<boolean> => {
    if (!current.current || blocked.current) return false;
    if (saving.current) return false;
    if (JSON.stringify(current.current) === saved.current) {
      localStorage.removeItem(journal);
      setStatus('已保存');
      return true;
    }
    saving.current = true;
    setStatus('保存中…');
    const payload = clone(current.current);
    try {
      const response = await mapWrite('mindmaps/' + entry.id, 'PUT', {
        ...payload,
        revision: revision.current,
        stamp: stamp.current,
      });
      revision.current = response.revision;
      stamp.current = response.stamp;
      saved.current = JSON.stringify(payload);
      if (alive.current) setLinked(response.linked);
      if (JSON.stringify(current.current) === saved.current) {
        localStorage.removeItem(journal);
        if (alive.current) setStatus('已保存');
      } else {
        writeJournal();
        if (alive.current) setStatus('有新修改，等待保存');
        schedule();
      }
      return true;
    } catch (e) {
      blocked.current = true;
      writeJournal();
      if (alive.current) {
        setError((e as Error).message);
        setStatus('保存失败 · 恢复副本已保留');
      }
      return false;
    } finally {
      saving.current = false;
    }
  };
  const accept = (next: Snapshot, record = true) => {
    if (readOnly.current) {
      setError('导图在回收站，请先恢复。');
      return false;
    }
    try {
      validateMap(next.data);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
    if (JSON.stringify(next) === JSON.stringify(current.current)) return true;
    if (record && current.current) {
      undo.current.push(clone(current.current));
      if (undo.current.length > 80) undo.current.shift();
      redo.current = [];
    }
    current.current = clone(next);
    setSnap(clone(next));
    if (!blocked.current) setError('');
    writeJournal();
    setStatus('未保存 · 正在保护');
    schedule();
    return true;
  };
  const refresh = (next: Snapshot, record = true) => {
    if (!accept(next, record)) return;
    loading.current = true;
    engine.current?.changeTheme(mapTheme(next.data.appearance || 'light'), false);
    engine.current?.refresh(clone(next.data));
    loading.current = false;
  };
  const model = () => {
    const raw = engine.current!.getData();
    const clean = (n: any): any => ({
      id: n.id,
      topic: n.topic,
      ...(n.expanded !== undefined ? { expanded: n.expanded } : {}),
      ...(n.direction !== undefined ? { direction: n.direction } : {}),
      ...(n.style ? { style: n.style } : {}),
      ...(n.branchColor ? { branchColor: n.branchColor } : {}),
      ...(n.metadata ? { metadata: n.metadata } : {}),
      children: (n.children || []).map(clean),
    });
    return {
      nodeData: clean(raw.nodeData),
      arrows: (raw.arrows || []).map((a) => ({
        id: a.id,
        from: a.from,
        to: a.to,
        label: a.label || '',
        bidirectional: !!a.bidirectional,
        ...(a.delta1 ? { delta1: a.delta1 } : {}),
        ...(a.delta2 ? { delta2: a.delta2 } : {}),
      })),
      direction: raw.direction ?? 2,
      compact: raw.compact ?? false,
      appearance: current.current?.data.appearance || 'light',
    };
  };
  const changed = () => {
    if (!loading.current && current.current && engine.current) {
      const m = engine.current,
        ids = new Set(mapNodes({ nodeData: m.nodeData }).map((r) => r.node.id));
      const arrows = m.arrows.filter((a) => ids.has(a.from) && ids.has(a.to));
      if (arrows.length !== m.arrows.length) {
        m.arrows = arrows;
        m.renderArrow();
      }
      if (!accept({ ...current.current, data: model() })) {
        loading.current = true;
        m.refresh(clone(current.current.data));
        loading.current = false;
        setError('本次操作超过导图限制或结构无效，未采用；已保留上一份有效结构。');
      }
      const n = m.currentNode?.nodeObj;
      if (n) setNodeText(n.topic);
    }
  };
  const select = (id: string) => {
    setSelected(id);
    const m = engine.current,
      all = current.current && mapNodes(current.current.data),
      row = all?.find((r) => r.node.id === id);
    setNodeText(row?.node.topic || '');
    if (m && row) {
      const next = clone(current.current!),
        list = mapNodes(next.data);
      let p = list.find((r) => r.node.id === id)?.parent,
        changed = false;
      while (p) {
        if (p.expanded === false) {
          p.expanded = true;
          changed = true;
        }
        p = list.find((r) => r.node.id === p.id)?.parent;
      }
      if (changed) refresh(next);
      const el = m.findEle(id);
      if (el) {
        m.selectNode(el);
        m.scrollIntoView(el, true);
      }
    }
  };
  const historyStep = (forward: boolean) => {
    const from = forward ? redo : undo,
      to = forward ? undo : redo,
      next = from.current.pop();
    if (next && current.current) {
      to.current.push(clone(current.current));
      refresh(next, false);
    }
  };
  const command = async (name: string) => {
    if (readOnly.current) {
      setError('导图在回收站，请先恢复。');
      return;
    }
    const m = engine.current;
    if (!m) return;
    if (selected && !host.current?.querySelector('[data-nodeid="me' + selected + '"]')) {
      setError('当前节点已折叠或删除，请在大纲重新选择可见节点。');
      return;
    }
    const el = selected ? m.findEle(selected) : m.findEle(m.nodeData.id);
    if (!el) return;
    try {
      if (name === 'child') {
        await m.addChild(el, { id: crypto.randomUUID(), topic: '新节点', children: [] });
        await m.beginEdit();
      }
      if (name === 'sibling' && el.nodeObj.parent) {
        await m.insertSibling('after', el, {
          id: crypto.randomUUID(),
          topic: '新节点',
          children: [],
        });
        await m.beginEdit();
      }
      if (name === 'edit') await m.beginEdit(el);
      if (name === 'delete') await m.removeNodes([el]);
      if (name === 'copy' && el.nodeObj.parent)
        await m.copyNode(el, m.findEle(el.nodeObj.parent.id));
      if (name === 'up') await m.moveUpNode(el);
      if (name === 'down') await m.moveDownNode(el);
      if (name === 'collapse') m.expandNode(el, !el.nodeObj.expanded);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    api('/mindmaps/' + entry.id)
      .then((response) => {
        if (disposed) return;
        const initial: Snapshot = {
          title: response.entry.title,
          data: response.data,
          ...Object.fromEntries(
            ['domains', 'tags', 'collections'].map((k) => [
              k,
              response.entry[k].map((t: any) => t.id),
            ]),
          ),
          primary_domain_id: response.entry.primary_domain_id || null,
        } as Snapshot;
        revision.current = response.revision;
        stamp.current = response.stamp;
        saved.current = JSON.stringify(initial);
        current.current = initial;
        setSnap(initial);
        setLinked(response.linked);
        setStatus('已保存');
        try {
          const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
          const pending = keys
            .map((k) => ({ ...JSON.parse(localStorage.getItem(k)!), key: k }))
            .filter((r) => r.payload && JSON.stringify(r.payload) !== saved.current)
            .sort((a, b) => b.at - a.at);
          if (pending.length) setRecovery(pending[0]);
        } catch {
          setError('恢复副本无法读取，正式导图未改动。');
        }
        const m = new MindElixir({
          el: host.current!,
          direction: 2,
          toolBar: false,
          contextMenu: false,
          keypress: false,
          allowUndo: false,
          editable: response.entry.lifecycle?.state !== 'trash',
          newTopicName: '新节点',
          theme: mapTheme(response.data.appearance || 'light'),
          before: {
            removeNodes: (els) =>
              !els.some((e) => !e.nodeObj.parent) &&
              confirm('删除所选分支及其跨分支连线？可撤销，正式知识不会被删除。'),
          },
        });
        engine.current = m;
        // The library initializes its host as relative. Our viewport is a bounded
        // absolute pane; keep its class distinct from the engine's inner canvas.
        host.current!.style.position = 'absolute';
        const err = m.init(clone(response.data));
        if (err) throw err;
        m.bus.addListener('operation', changed);
        m.bus.addListener('expandNode', changed);
        m.bus.addListener('updateArrowDelta', changed);
        m.bus.addListener('selectNodes', (nodes) => {
          if (nodes[0]) {
            setSelected(nodes[0].id);
            setNodeText(nodes[0].topic);
          }
        });
        m.selectNode(m.findEle(response.data.nodeData.id));
        m.toCenter();
        host.current?.focus();
        if (sessionStorage.getItem('pk-map-autofocus') === entry.id) {
          sessionStorage.removeItem('pk-map-autofocus');
          void m.beginEdit();
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      alive.current = false;
      clearTimeout(timer.current);
      engine.current?.destroy();
      engine.current = null;
    };
  }, [entry.id]);
  useEffect(() => {
    const el = host.current;
    const finish = (e: FocusEvent) => {
      if ((e.target as HTMLElement).id === 'input-box') setTimeout(changed, 0);
    };
    // Mind Elixir removes its edit element in blur; listen before removal rather
    // than relying on React's later focusout delegation.
    el?.addEventListener('blur', finish, true);
    return () => el?.removeEventListener('blur', finish, true);
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (current.current && JSON.stringify(current.current) !== saved.current) {
        writeJournal();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const check = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (current.current && JSON.stringify(current.current) !== saved.current) d.dirty = true;
      if (saving.current) d.busy = true;
      d.close.push(onClose);
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('pk-history-check', check);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pk-history-check', check);
    };
  }, []);
  useEffect(() => {
    const guard = (e: Event) => {
      (e as CustomEvent).detail.check = async () => {
        let allowed = false;
        await leave(() => {
          allowed = true;
        });
        return allowed;
      };
    };
    window.addEventListener('pk-map-leave-check', guard);
    return () => window.removeEventListener('pk-map-leave-check', guard);
  }, []);
  useEffect(() => {
    if (!linkSearch.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(
      () =>
        api('/entries?library=1&q=' + encodeURIComponent(linkSearch))
          .then((r) => active && setResults(r.items.filter((e: Entry) => e.id !== entry.id)))
          .catch((e) => setError(e.message)),
      250,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [linkSearch, entry.id]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!snap || !engine.current) return;
      for (const r of mapNodes(snap.data)) {
        const el = host.current?.querySelector<HTMLElement>('[data-nodeid="me' + r.node.id + '"]');
        if (el) {
          if (r.node.metadata?.contentId) {
            el.dataset.linked = 'true';
            el.title = r.node.topic + ' · 已链接站内知识';
          } else {
            delete el.dataset.linked;
            el.title = r.node.topic;
          }
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [snap]);
  useEffect(() => {
    if (engine.current) {
      if (readOnly.current) engine.current.disableEdit();
      else engine.current.enableEdit();
    }
  }, [entry.lifecycle?.state]);
  const leave = async (fn: () => void) => {
    (document.activeElement as HTMLElement)?.blur();
    clearTimeout(timer.current);
    if (saving.current) {
      setError('正在保存，请稍候再离开。');
      return;
    }
    if (current.current && JSON.stringify(current.current) !== saved.current) {
      const ok = await flush();
      if (!ok && !confirm('尚未保存。恢复副本将保留，确认离开？建议先导出JSON。')) return;
    }
    fn();
  };
  const selectedRow = snap && mapNodes(snap.data).find((r) => r.node.id === selected),
    rows = snap ? mapNodes(snap.data) : [];
  const modifyNode = (patch: any) => {
    if (!snap || !selectedRow) return;
    const next = clone(snap);
    Object.assign(mapNodes(next.data).find((r) => r.node.id === selected)!.node, patch);
    refresh(next);
  };
  const setParent = (parentId: string) => {
    if (!snap || !selectedRow?.parent) return;
    const next = clone(snap),
      all = mapNodes(next.data),
      r = all.find((r) => r.node.id === selected)!,
      to = all.find((r) => r.node.id === parentId)!.node;
    if (mapNodes({ nodeData: r.node }).some((x) => x.node.id === parentId)) {
      setError('不能将节点移入自身或后代。');
      return;
    }
    r.parent.children = r.parent.children.filter((n: any) => n.id !== selected);
    (to.children ||= []).push(r.node);
    to.expanded = true;
    refresh(next);
  };
  const exportFile = async (kind: string) => {
    try {
      const c = current.current;
      if (!c) return;
      let blob: Blob | null;
      if (kind === 'json')
        blob = new Blob(
          [
            JSON.stringify(
              { format: mapFormat, version: 1, title: c.title, data: c.data },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        );
      else if (kind === 'md')
        blob = new Blob([mapMarkdown(c.data, c.title)], { type: 'text/markdown' });
      else blob = await exportMindmap(engine.current!, kind === 'svg' ? 'svg' : 'png');
      if (!blob) throw Error('图片导出失败，请尝试SVG或JSON。');
      downloadMap(blob, c.title.replace(/[\\/:*?"<>|]/g, '_') + '.' + kind);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="mindmap-workbench" aria-label="思维导图编辑器">
      <header className="map-header">
        <button onClick={() => leave(onClose)}>← 返回</button>
        <input
          aria-label="导图标题"
          maxLength={200}
          value={snap?.title || ''}
          disabled={!snap || entry.lifecycle?.state === 'trash'}
          onChange={(e) => snap && accept({ ...snap, title: e.target.value })}
        />
        <span role="status">{status}</span>
        <button
          onClick={() => {
            blocked.current = false;
            setError('');
            void flush();
          }}
        >
          保存
        </button>
        <ContentActions entry={entry} onChanged={onChanged} onEdit={() => setPanel(true)} />
      </header>
      <nav className="map-toolbar" aria-label="导图操作">
        <button
          onClick={() =>
            snap &&
            refresh({
              ...snap,
              data: {
                ...snap.data,
                appearance: snap.data.appearance === 'dark' ? 'light' : 'dark',
              },
            })
          }
        >
          明暗主题
        </button>
        <button onClick={() => setOutline(!outline)} aria-pressed={outline}>
          大纲
        </button>
        <button onClick={() => command('child')}>子节点 Tab</button>
        <button onClick={() => command('sibling')}>同级 Enter</button>
        <button onClick={() => command('edit')}>编辑 F2</button>
        <button onClick={() => command('copy')}>复制分支</button>
        <button onClick={() => command('delete')}>删除</button>
        <button onClick={() => historyStep(false)}>撤销</button>
        <button onClick={() => historyStep(true)}>重做</button>
        <button onClick={() => engine.current?.scaleFit()}>适应画布</button>
        <button onClick={() => engine.current?.toCenter()}>中心</button>
        <button
          onClick={() =>
            engine.current?.scale(Math.min(2.5, (engine.current?.scaleVal || 1) + 0.15))
          }
        >
          ＋缩放
        </button>
        <button
          onClick={() =>
            engine.current?.scale(Math.max(0.2, (engine.current?.scaleVal || 1) - 0.15))
          }
        >
          －缩放
        </button>
        <button aria-pressed={panel} onClick={() => setPanel(!panel)}>
          节点与关联
        </button>
        <details>
          <summary>管理与导出</summary>
          <div className="map-menu">
            {['png', 'svg', 'json', 'md'].map((k) => (
              <button key={k} onClick={() => exportFile(k)}>
                导出 {k.toUpperCase()}
              </button>
            ))}
            <button
              onClick={async () => {
                await leave(async () => {
                  if (!current.current) return;
                  const r = await mapWrite('mindmaps', 'POST', {
                    ...current.current,
                    title: current.current.title + ' · 副本',
                  });
                  onChanged();
                  onOpen(r.entry.id);
                });
              }}
            >
              复制导图
            </button>
            <button onClick={() => api('/mindmaps/' + entry.id + '/versions').then(setHistoryRows)}>
              恢复历史
            </button>
            <label>
              导入JSON（新建）
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  try {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 1000000) throw Error('导入上限1MB。');
                    setImported(
                      await mapWrite('mindmap-import/preview', 'POST', JSON.parse(await f.text())),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </details>
      </nav>
      {error && (
        <div role="alert" className="map-error">
          {error} <button onClick={() => exportFile('json')}>导出当前恢复稿</button>
          {blocked.current && (
            <button
              onClick={() => {
                if (confirm('重新加载正式版本？本地恢复副本保留，可导出后比较。'))
                  location.reload();
              }}
            >
              重新加载
            </button>
          )}
        </div>
      )}
      {recovery && (
        <div className="map-recovery">
          发现未保存恢复副本（{new Date(recovery.at).toLocaleString()}）。
          {recovery.base === revision.current && recovery.stamp === stamp.current ? (
            <button
              onClick={() => {
                refresh(recovery.payload);
                localStorage.removeItem(recovery.key);
                writeJournal();
                setRecovery(null);
              }}
            >
              恢复到编辑器
            </button>
          ) : (
            <span>正式版本已改变，禁止直接覆盖。</span>
          )}
          <button
            onClick={() =>
              downloadMap(
                new Blob([
                  JSON.stringify({
                    format: mapFormat,
                    version: 1,
                    title: recovery.payload.title,
                    data: recovery.payload.data,
                  }),
                ]),
                '恢复稿.json',
              )
            }
          >
            导出恢复稿
          </button>
          <button
            onClick={() => {
              if (confirm('丢弃此恢复副本？')) {
                localStorage.removeItem(recovery.key);
                setRecovery(null);
              }
            }}
          >
            放弃副本
          </button>
        </div>
      )}
      <div className={'map-layout' + (outline ? ' has-outline' : '') + (panel ? ' has-panel' : '')}>
        {outline && (
          <aside className="map-outline">
            <header>
              <strong>文字大纲</strong>
              <button onClick={() => setOutline(false)}>收起</button>
            </header>
            <p className="muted">与画布共用节点 · {snap?.data.arrows.length || 0} 条跨分支连线</p>
            {rows
              .filter((r) => {
                let p = r.parent;
                while (p) {
                  if (p.expanded === false) return false;
                  p = rows.find((x) => x.node.id === p.id)?.parent;
                }
                return true;
              })
              .map(({ node, depth }) => (
                <div
                  key={node.id}
                  className={selected === node.id ? 'active' : ''}
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  {!!node.children?.length && (
                    <button
                      className="map-fold"
                      aria-label={'折叠或展开 ' + node.topic}
                      aria-expanded={node.expanded !== false}
                      onClick={() => {
                        const next = clone(snap!);
                        const n = mapNodes(next.data).find((r) => r.node.id === node.id)!.node;
                        n.expanded = n.expanded === false;
                        refresh(next);
                      }}
                    >
                      {node.expanded === false ? '▸' : '▾'}
                    </button>
                  )}
                  <button onClick={() => select(node.id)} title={node.topic}>
                    {node.topic}
                    {node.metadata ? ' ↗' : ''}
                  </button>
                </div>
              ))}
          </aside>
        )}
        <div className="map-canvas-wrap">
          <div
            ref={host}
            className="pk-map-host"
            tabIndex={0}
            aria-label="导图画布"
            onInputCapture={(e) => {
              const el = e.target as HTMLElement;
              if (el.id === 'input-box' && current.current && engine.current?.currentNode) {
                const next = clone(current.current),
                  n = mapNodes(next.data).find(
                    (r) => r.node.id === engine.current!.currentNode!.nodeObj.id,
                  );
                if (n && el.innerText.trim()) {
                  n.node.topic = el.innerText;
                  accept(next);
                }
              }
            }}
            onKeyDownCapture={(e) => {
              if ((e.target as HTMLElement).closest('input,textarea,[contenteditable]')) {
                if (e.key === 'Escape') setTimeout(changed, 0);
                return;
              }
              let action = '';
              if (e.key === 'Tab') action = 'child';
              if (e.key === 'Enter') action = 'sibling';
              if (e.key === 'F2') action = 'edit';
              if (e.key === 'Delete') action = 'delete';
              if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                e.stopPropagation();
                historyStep(e.key.toLowerCase() === 'y' || e.shiftKey);
                return;
              }
              if (action) {
                e.preventDefault();
                e.stopPropagation();
                void command(action);
              }
            }}
          />
          <footer>
            拖动节点调整层级/顺序 · 自动树形布局 · 双击编辑 · 选节点后打开“节点与关联”
          </footer>
        </div>
        {panel && (
          <aside className="map-inspector">
            <header>
              <strong>节点与关联</strong>
              <button onClick={() => setPanel(false)}>收起</button>
            </header>
            <label>
              查找节点
              <input value={find} onChange={(e) => setFind(e.target.value)} />
            </label>
            {find &&
              rows
                .filter((r) => r.node.topic.includes(find))
                .slice(0, 30)
                .map((r) => (
                  <button
                    key={r.node.id}
                    onClick={() => {
                      const next = clone(current.current!);
                      mapNodes(next.data).forEach((x) => (x.node.expanded = true));
                      refresh(next);
                      select(r.node.id);
                    }}
                  >
                    {r.node.topic}
                  </button>
                ))}
            {selectedRow && (
              <>
                <h3>当前节点</h3>
                <textarea
                  aria-label="节点文字"
                  maxLength={2000}
                  value={nodeText}
                  onChange={(e) => {
                    setNodeText(e.target.value);
                    if (e.target.value.trim()) modifyNode({ topic: e.target.value });
                  }}
                />
                <button onClick={() => modifyNode({ topic: nodeText })}>应用文字</button>
                <div className="map-row">
                  <button onClick={() => command('up')}>上移</button>
                  <button onClick={() => command('down')}>下移</button>
                  <button onClick={() => command('collapse')}>折叠 / 展开</button>
                </div>
                {selectedRow.parent && (
                  <label>
                    移入父节点
                    <select
                      aria-label="节点父级"
                      value={selectedRow.parent.id}
                      onChange={(e) => setParent(e.target.value)}
                    >
                      {rows.map((r) => (
                        <option key={r.node.id} value={r.node.id}>
                          {'　'.repeat(r.depth)}
                          {r.node.topic}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  分支颜色
                  <input
                    type="color"
                    value={selectedRow.node.branchColor || '#5877b8'}
                    onChange={(e) => modifyNode({ branchColor: e.target.value })}
                  />
                </label>
                <button
                  onClick={() =>
                    modifyNode({
                      style: {
                        ...(selectedRow.node.style || {}),
                        fontWeight:
                          selectedRow.node.style?.fontWeight === 'bold' ? 'normal' : 'bold',
                      },
                    })
                  }
                >
                  加粗 / 常规
                </button>
                <h3>链接站内知识</h3>
                {selectedRow.node.metadata?.contentId && (
                  <div className="map-knowledge-link">
                    {linked.find((l) => l.id === selectedRow.node.metadata.contentId)?.title ||
                      '已关联知识'}
                    {linked.find((l) => l.id === selectedRow.node.metadata.contentId)?.state ===
                    'trash' ? (
                      <p>目标在回收站，请先恢复。</p>
                    ) : (
                      <button
                        onClick={() =>
                          leave(() => {
                            sessionStorage.setItem('pk-map-return', entry.id);
                            onOpen(selectedRow.node.metadata.contentId);
                          })
                        }
                      >
                        打开知识 ↗
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const next = clone(snap!);
                        delete mapNodes(next.data).find((r) => r.node.id === selected)!.node
                          .metadata;
                        refresh(next);
                      }}
                    >
                      解除链接
                    </button>
                  </div>
                )}
                <input
                  aria-label="搜索关联知识"
                  placeholder="搜索内容或章节…"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                />
                {results.map((e) => (
                  <div className="map-result" key={e.id}>
                    <span>{e.title}</span>
                    <button
                      onClick={() => {
                        modifyNode({ metadata: { contentId: e.id } });
                        setLinked((a) => [
                          ...a.filter((l) => l.id !== e.id),
                          { id: e.id, title: e.title, state: e.lifecycle?.state || 'done' },
                        ]);
                        setLinkSearch('');
                      }}
                    >
                      链接当前节点
                    </button>
                    <button
                      onClick={async () => {
                        const m = engine.current;
                        if (!m) return;
                        await m.addChild(m.findEle(selected), {
                          id: crypto.randomUUID(),
                          topic: e.title,
                          metadata: { contentId: e.id },
                          children: [],
                        });
                        setLinked((a) => [
                          ...a,
                          { id: e.id, title: e.title, state: e.lifecycle?.state || 'done' },
                        ]);
                        setLinkSearch('');
                      }}
                    >
                      插入知识节点
                    </button>
                  </div>
                ))}
                <h3>跨分支连线</h3>
                <label>
                  目标节点
                  <select
                    aria-label="连线目标"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">选择节点</option>
                    {rows
                      .filter((r) => r.node.id !== selected)
                      .map((r) => (
                        <option key={r.node.id} value={r.node.id}>
                          {r.node.topic}
                        </option>
                      ))}
                  </select>
                </label>
                <input
                  aria-label="连线说明"
                  value={label}
                  maxLength={200}
                  placeholder="关系说明"
                  onChange={(e) => setLabel(e.target.value)}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={both}
                    onChange={(e) => setBoth(e.target.checked)}
                  />
                  双向（默认从当前节点指向目标）
                </label>
                <button
                  disabled={!target}
                  onClick={() => {
                    const next = clone(snap!);
                    next.data.arrows.push({
                      id: crypto.randomUUID(),
                      from: selected,
                      to: target,
                      label,
                      bidirectional: both,
                    });
                    refresh(next);
                  }}
                >
                  添加独立连线
                </button>
              </>
            )}
            {snap?.data.arrows.map((a: any) => (
              <div className="map-link-row" key={a.id}>
                <span>
                  {rows.find((r) => r.node.id === a.from)?.node.topic} {a.bidirectional ? '↔' : '→'}{' '}
                  {rows.find((r) => r.node.id === a.to)?.node.topic}
                </span>
                <input
                  aria-label={'修改连线 ' + a.id}
                  maxLength={200}
                  value={a.label}
                  onChange={(e) => {
                    const next = clone(snap);
                    next.data.arrows.find((x: any) => x.id === a.id).label = e.target.value;
                    refresh(next);
                  }}
                />
                <button
                  onClick={() => {
                    const next = clone(snap);
                    next.data.arrows = next.data.arrows.filter((x: any) => x.id !== a.id);
                    refresh(next);
                  }}
                >
                  删除连线
                </button>
              </div>
            ))}
            <h3>导图分类</h3>
            {snap &&
              (['domains', 'tags', 'collections'] as const).map((k, i) => (
                <fieldset key={k}>
                  <legend>{['领域', '标签', '专题'][i]}</legend>
                  {meta[k].map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={snap[k].includes(t.id)}
                        onChange={(e) =>
                          accept({
                            ...snap,
                            [k]: e.target.checked
                              ? [...snap[k], t.id]
                              : snap[k].filter((id) => id !== t.id),
                            ...(k === 'domains' &&
                            !e.target.checked &&
                            snap.primary_domain_id === t.id
                              ? { primary_domain_id: null }
                              : {}),
                          })
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            {snap && (
              <label>
                主要领域
                <select
                  value={snap.primary_domain_id || ''}
                  onChange={(e) => accept({ ...snap, primary_domain_id: e.target.value || null })}
                >
                  <option value="">未指定</option>
                  {meta.domains
                    .filter((t) => snap.domains.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </aside>
        )}
      </div>
      {historyRows && (
        <Dialog title="导图历史（放入编辑器后保存）" onClose={() => setHistoryRows(null)}>
          <p>当前正式版本不会被直接覆盖。恢复后仍可撤销，保存时保留上一版。</p>
          {historyRows.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                refresh({ ...current.current!, title: r.title, data: JSON.parse(r.data_json) });
                setHistoryRows(null);
              }}
            >
              修订 {r.revision} · {new Date(r.created_at).toLocaleString()}
            </button>
          ))}
          {!historyRows.length && <p>尚无历史。</p>}
        </Dialog>
      )}
      {imported && (
        <Dialog title="导图导入预览" onClose={() => setImported(null)}>
          <h3>{imported.title}</h3>
          <p>
            {validateMap(imported.data).count} 个节点 / {imported.data.arrows.length}{' '}
            条连线。仅创建新导图；保留节点ID和知识链接，未知站内ID会拒绝。
          </p>
          <ol>
            {mapNodes(imported.data).map((r) => (
              <li key={r.node.id} style={{ marginLeft: r.depth * 16 }}>
                {r.node.topic}
              </li>
            ))}
          </ol>
          <button
            className="primary"
            onClick={() =>
              leave(async () => {
                try {
                  const r = await mapWrite('mindmaps', 'POST', {
                    ...imported,
                    domains: [],
                    tags: [],
                    collections: [],
                  });
                  onChanged();
                  setImported(null);
                  onOpen(r.entry.id);
                } catch (e) {
                  setError((e as Error).message);
                }
              })
            }
          >
            确认新建导图
          </button>
        </Dialog>
      )}
    </section>
  );
}
export async function createMindmap() {
  const result = await mapWrite('mindmaps', 'POST', {
    title: '未命名思维导图',
    data: newMap(),
    domains: [],
    tags: [],
    collections: [],
  });
  sessionStorage.setItem('pk-map-autofocus', result.entry.id);
  return result;
}
