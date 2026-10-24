import { useEffect, useRef, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import { AiReviewItem } from './AiReviewItem';
export const relationLabels: Record<string, string> = {
  reference: '引用',
  complement: '补充',
  conflict: '冲突',
  revision: '修正',
  dependency: '依赖',
  composition: '组成',
  related: '相关',
};
export const directionLabel = (r: any, id: string) => {
  const out = r.from_id === id;
  return (
    {
      reference: out ? '引用' : '被引用',
      complement: out ? '被补充' : '补充了',
      conflict: '存在冲突',
      revision: out ? '被修正' : '修正了',
      dependency: out ? '依赖' : '被依赖',
      composition: out ? '是其组成部分' : '包含组成部分',
      related: '相关',
    } as any
  )[r.type];
};
export async function relationWrite(path: string, body: any, signal?: AbortSignal) {
  const s = await api('/local/session');
  return api('/relations/' + path, {
    method: 'POST',
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify(body),
    signal,
  });
}
export function RelatedPanel({
  id,
  onOpen,
  onChanged,
  onExplore,
  selectionQuote,
}: {
  id: string;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onExplore?: (id: string) => void;
  selectionQuote?: string;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [tick, setTick] = useState(0),
    [error, setError] = useState(''),
    [edit, setEdit] = useState<any>(null),
    [q, setQ] = useState(''),
    [options, setOptions] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [plan, setPlan] = useState<any>(null),
    [token, setToken] = useState(''),
    [adopt, setAdopt] = useState<number[]>([]),
    [estimate, setEstimate] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [domain, setDomain] = useState(''),
    [topic, setTopic] = useState(''),
    [meta, setMeta] = useState<any>(null);
  const controller = useRef<AbortController | null>(null),
    reviewToken = useRef('');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api('/entries/' + id)
      .then((r) => setNames((ns) => ({ ...ns, [id]: r.title })))
      .catch(() => {});
  }, [id]);
  useEffect(() => {
    let live = true;
    api('/relations/' + id)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, tick]);
  useEffect(() => {
    if (!edit) return;
    let live = true;
    const t = setTimeout(
      () =>
        api(
          '/relation-candidates?' +
            new URLSearchParams({ center: id, q, domain, collection: topic }),
        )
          .then((r) => {
            if (live) {
              setOptions(r);
              setNames((ns) => ({
                ...ns,
                ...Object.fromEntries(r.map((n: any) => [n.id, n.title])),
              }));
            }
          })
          .catch((e) => live && setError(e.message)),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id, q, domain, topic, !!edit]);
  useEffect(() => {
    reviewToken.current = token;
  }, [token]);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (reviewToken.current)
        relationWrite('cancel', { token: reviewToken.current }).catch(() => {});
    },
    [id],
  );
  const refresh = () => {
    setTick((n) => n + 1);
    onChanged();
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) {
      controller.current?.abort();
      return;
    }
    if ((plan || edit?.note) && !confirm('取消尚未保存的关联审核？原内容保留。')) return;
    if (token) relationWrite('cancel', { token }).catch(() => {});
    setEdit(null);
    setPlan(null);
    setToken('');
    setSelected([]);
  };
  const start = () => {
    setEdit({
      from_id: id,
      to_id: '',
      type: 'related',
      note: '',
      uncertainty: '',
      evidence: selectionQuote ? [{ id, quote: selectionQuote }] : [],
    });
    setPlan(null);
    setSelected([]);
    api('/meta').then(setMeta);
  };
  return (
    <details className="related-panel" open={selectionQuote ? true : undefined}>
      <summary>相关知识 · {rows.length}</summary>
      <p className="muted">有方向的关系声明；候选未经确认，冲突不判断哪一方正确。</p>
      <div className="knowledge-actions">
        <button onClick={start}>关联知识</button>
        <a href={'#content-' + id}>稳定站内入口</a>
        {onExplore && <button onClick={() => onExplore(id)}>探索局部地图</button>}
      </div>
      {rows.map((r) => (
        <article className="relation-row" key={r.id}>
          <button onClick={() => onOpen(r.other.id)}>
            {directionLabel(r, id)}：{r.other.title}
          </button>
          <small>
            {relationLabels[r.type]} ·{' '}
            {r.origin === 'system'
              ? '确定性记录'
              : r.origin === 'ai'
                ? 'AI建议'
                : r.origin === 'import'
                  ? '导入候选'
                  : r.origin === 'manual'
                    ? '人工建立'
                    : '历史待核对'}{' '}
            · {r.state === 'candidate' ? '待确认' : '已确认'}
          </small>
          <p>{r.note}</p>
          <details>
            <summary>依据与不确定性</summary>
            {r.evidence.map((e: any, i: number) => (
              <blockquote key={i}>
                {e.id}：{e.quote}
              </blockquote>
            ))}
            <p>{r.uncertainty}</p>
          </details>
          {!r.system && (
            <div className="knowledge-actions">
              {!r.system && (
                <button
                  onClick={() => {
                    setEdit({ ...r, to_id: r.to_id, from_id: r.from_id });
                    setPlan(null);
                    api('/meta').then(setMeta);
                  }}
                >
                  修改关联
                </button>
              )}
              {r.state === 'candidate' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!confirm('确认此关系？不改原文，也不判断冲突正确性。')) return;
                      await relationWrite('review', {
                        id: r.id,
                        action: 'confirm',
                        confirm: '确认关系',
                      });
                      refresh();
                    })
                  }
                >
                  确认关系
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!confirm('移除关系？两份原文保留，关系历史可恢复。')) return;
                    await relationWrite('review', { id: r.id, action: 'reject' });
                    refresh();
                  })
                }
              >
                移除关系
              </button>
            </div>
          )}
        </article>
      ))}
      {!rows.length && (
        <p className="muted">暂无关联，可以人工搜索内容或章节；AI分析是可选操作。</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {edit && (
        <Dialog title="关联知识与人工审核" wide onClose={close}>
          <div className="relation-editor">
            <p>
              选择真实内容或章节；组成声明不会自动调整文档父级。补充/修正的方向为“B补充或修正A”。
            </p>
            <div className="library-filterbar">
              <input
                aria-label="搜索关联目标"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="本地检索标题、简介和正文"
              />
              <select
                aria-label="关联领域范围"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="">全部领域</option>
                {meta?.domains.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="关联专题范围"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                <option value="">全部专题</option>
                {meta?.collections.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="relation-candidates">
              {options.map((r) => (
                <div key={r.id}>
                  <button
                    aria-pressed={edit.to_id === r.id || edit.from_id === r.id}
                    aria-label={'关联目标 ' + r.title}
                    onClick={() =>
                      setEdit((p: any) =>
                        p.from_id === id
                          ? {
                              ...p,
                              to_id: r.id,
                              evidence:
                                p.to_id === r.id
                                  ? p.evidence
                                  : p.evidence.filter((e: any) => e.id === id),
                            }
                          : {
                              ...p,
                              from_id: r.id,
                              to_id: id,
                              evidence:
                                p.from_id === r.id
                                  ? p.evidence
                                  : p.evidence.filter((e: any) => e.id === id),
                            },
                      )
                    }
                  >
                    {r.title} · {r.type}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={'AI关联资料 ' + r.title}
                      checked={selected.includes(r.id)}
                      onChange={() => {
                        setSelected((xs) =>
                          xs.includes(r.id) ? xs.filter((x) => x !== r.id) : [...xs, r.id],
                        );
                        setEstimate(null);
                      }}
                    />
                    选择用于AI
                  </label>
                  <small>{r.reasons.join(' / ')}</small>
                  <p>{r.excerpt}</p>
                </div>
              ))}
            </div>
            <label>
              方向
              <select
                aria-label="关联方向"
                value={edit.from_id === id ? 'out' : 'in'}
                onChange={(e) =>
                  setEdit((p: any) =>
                    e.target.value === 'in'
                      ? { ...p, from_id: p.to_id, to_id: id }
                      : { ...p, to_id: p.from_id, from_id: id },
                  )
                }
              >
                <option value="out">A=当前内容 → B=所选目标</option>
                <option value="in">A=所选目标 → B=当前内容</option>
              </select>
            </label>
            <label>
              关系类型
              <select
                aria-label="关联类型"
                value={edit.type}
                onChange={(e) => setEdit((p: any) => ({ ...p, type: e.target.value }))}
              >
                {Object.entries(relationLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              具体依据
              <textarea
                aria-label="关联依据"
                maxLength={1000}
                value={edit.note}
                onChange={(e) => setEdit((p: any) => ({ ...p, note: e.target.value }))}
              />
            </label>
            <label>
              不确定性
              <input
                aria-label="关联不确定性"
                value={edit.uncertainty}
                onChange={(e) => setEdit((p: any) => ({ ...p, uncertainty: e.target.value }))}
              />
            </label>
            <div className="form-footer">
              <button
                disabled={busy || !edit.to_id || !edit.from_id || !edit.note.trim()}
                className="primary"
                onClick={() =>
                  run(async () => {
                    if (!confirm('保存人工关联？请核对A/B方向；正文不会更改。')) return;
                    await relationWrite('save', { ...edit, confirm: '保存人工关联' });
                    setEdit(null);
                    refresh();
                  })
                }
              >
                保存人工关联
              </button>
              <button onClick={close}>取消</button>
            </div>
            <section>
              <h3>AI关联发现（当前内容 + 主动选择的资料）</h3>
              <p>最多10份完整资料；不默认上传整个领域或专题，标题网址不能冒充正文。</p>
              <button
                disabled={busy || !selected.length || selected.length > 9}
                onClick={() =>
                  run(async () =>
                    setEstimate(await relationWrite('estimate', { ids: [id, ...selected] })),
                  )
                }
              >
                预览输入与费用
              </button>
              {estimate && (
                <p>
                  {estimate.chars}字符 / 约{estimate.tokens} Token / 输入参考 $
                  {estimate.estimatedUSD.toFixed(6)}（输出另计）。
                  {estimate.insufficient ? '信息不足' : ''}
                </p>
              )}
              <button
                disabled={busy || !estimate || estimate.insufficient}
                onClick={() =>
                  run(async () => {
                    if (!confirm('仅发送主动选中的资料进行AI关联分析？可能产生API费用。')) return;
                    controller.current = new AbortController();
                    const r = await relationWrite(
                      'generate',
                      { ids: [id, ...selected] },
                      controller.current.signal,
                    );
                    setPlan(r.suggestion);
                    setToken(r.token || '');
                    setAdopt([]);
                  })
                }
              >
                {busy ? '分析中…' : '生成关联建议'}
              </button>
              {busy && <button onClick={() => controller.current?.abort()}>取消生成</button>}
            </section>
            {plan && (
              <section className="relation-ai-review">
                <p>候选与正式关系分开；采用仅保存待确认建议，可再逐条确认或拒绝。</p>
                {plan.missing.map((m: string, i: number) => (
                  <p key={i}>{m}</p>
                ))}
                {plan.suggestions.map((s: any, i: number) => (
                  <AiReviewItem
                    title={'关联候选 ' + (i + 1)}
                    key={i}
                    before={(names[s.from_id] || s.from_id) + ' → ' + (names[s.to_id] || s.to_id)}
                    after={relationLabels[s.type]}
                    reason={s.note}
                    affected={2}
                    contentChange={false}
                    relationChange
                  >
                    <label>
                      <input
                        type="checkbox"
                        aria-label={'采用关联建议 ' + i}
                        checked={adopt.includes(i)}
                        onChange={() =>
                          setAdopt((ns) =>
                            ns.includes(i) ? ns.filter((n) => n !== i) : [...ns, i],
                          )
                        }
                      />
                      选择此建议
                    </label>
                    <select
                      aria-label={'AI关系类型 ' + i}
                      value={s.type}
                      onChange={(e) =>
                        setPlan((p: any) => ({
                          ...p,
                          suggestions: p.suggestions.map((v: any, n: number) =>
                            n === i ? { ...v, type: e.target.value } : v,
                          ),
                        }))
                      }
                    >
                      {Object.entries(relationLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <textarea
                      aria-label={'AI关联依据 ' + i}
                      value={s.note}
                      onChange={(e) =>
                        setPlan((p: any) => ({
                          ...p,
                          suggestions: p.suggestions.map((v: any, n: number) =>
                            n === i ? { ...v, note: e.target.value } : v,
                          ),
                        }))
                      }
                    />
                    {s.evidence.map((e: any, n: number) => (
                      <blockquote key={n}>
                        {e.id}：{e.quote}
                      </blockquote>
                    ))}
                    <p>{s.uncertainty}</p>
                  </AiReviewItem>
                ))}
                <button
                  className="primary"
                  disabled={busy || !token || !adopt.length}
                  onClick={() =>
                    run(async () => {
                      if (!confirm('采用所选方案，保存为AI待确认关系？')) return;
                      await relationWrite('apply', {
                        token,
                        plan,
                        selected: adopt,
                        confirm: '采用关联建议',
                      });
                      setPlan(null);
                      setEdit(null);
                      setToken('');
                      refresh();
                    })
                  }
                >
                  采用所选关联候选
                </button>
                <button
                  onClick={() => {
                    if (token) relationWrite('cancel', { token }).catch(() => {});
                    setPlan(null);
                    setToken('');
                  }}
                >
                  拒绝所有建议
                </button>
              </section>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </details>
  );
}
