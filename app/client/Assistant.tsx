import { useEffect, useRef, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import { KnowledgeIntegration } from './KnowledgeIntegration';
import { AiReviewItem } from './AiReviewItem';
export const assistantWrite = async (path: string, body: any, signal?: AbortSignal) => {
  const session = await api('/local/session');
  return api('/assistant/' + path, {
    method: 'POST',
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify(body),
    signal,
  });
};
const kindLabels: Record<string, string> = {
  entries: '资源/知识',
  directories: '旧目录（兼容引用）',
  domains: '领域',
  tags: '标签',
  collections: '专题',
};
const actions: Record<string, string> = {
  rename: '重命名',
  merge: '合并',
  move: '移动',
  associate: '关联',
  create: '创建',
  keep: '保持现状',
};
type ObjectInfo = {
  parent?: string | null;
  directory?: string | null;
  key: string;
  kind: string;
  id: string;
  name: string;
  count: number;
  entryKind?: string;
  hasEvidence: boolean;
  excerpt: string;
  pageId?: string;
};
export function Assistant({
  onOpen,
  onChanged,
  initialTab = 'ask',
  registerLeave,
  initialContext,
  initialQuestion,
  initialSpace = 'personal',
}: {
  onOpen: (key: string) => void;
  onChanged: () => void;
  initialTab?: string;
  registerLeave: (fn: (() => Promise<boolean>) | undefined) => void;
  initialContext?: string;
  initialQuestion?: string;
  initialSpace?: string;
}) {
  const [space, setSpace] = useState(initialSpace);
  useEffect(()=>{setSpace(initialSpace);setKeys([]);setMatches([]);setResult(null);},[initialSpace]);
  const [tab, setTab] = useState(initialTab),
    [objects, setObjects] = useState<ObjectInfo[]>([]),
    [candidates, setCandidates] = useState<any[]>([]),
    [matches, setMatches] = useState<ObjectInfo[]>([]),
    [question, setQuestion] = useState(initialQuestion || ''),
    [filter, setFilter] = useState(''),
    [keys, setKeys] = useState<string[]>([]),
    [scopeKeys, setScopeKeys] = useState<string[]>([]),
    [scopeItems, setScopeItems] = useState<ObjectInfo[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [target, setTarget] = useState(''),
    [newTitle, setNewTitle] = useState('综合知识页面'),
    [newDir, setNewDir] = useState(''),
    [integrationOpen, setIntegrationOpen] = useState(false),
    [result, setResult] = useState<any>(null),
    [selected, setSelected] = useState<number[]>([]),
    [diff, setDiff] = useState<any>(null),
    [estimate, setEstimate] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [historyOpen, setHistoryOpen] = useState(false);
  const controller = useRef<AbortController | null>(null),
    reviewToken = useRef<string | null>(null),
    mode = tab === 'ask' ? 'assistant_qa' : 'assistant_structure';
  useEffect(() => {
    if (initialContext && objects.length) {
      const o = objects.find((x) => x.key === initialContext);
      if (o) {
        setMatches([o]);
        setKeys([o.key]);
      }
    }
  }, [initialContext, objects.length]);
  reviewToken.current = result?.token || null;
  useEffect(() => {
    controller.current?.abort();
    if (result?.token) assistantWrite('cancel', { token: result.token }).catch(() => {});
    setTab(initialTab);
    setResult(null);
    setKeys([]);
    setSelected([]);
    setDiff(null);
  }, [initialTab]);
  useEffect(() => {
    const pending = (tab === 'structure' && !!result) || busy;
    registerLeave(() =>
      Promise.resolve(
        !pending ||
          confirm('离开知识助手？尚未保存的审核方案会丢弃，正在生成的请求将取消；原资料保留。'),
      ),
    );
    const unload = (e: BeforeUnloadEvent) => {
      if (pending) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      registerLeave(undefined);
      window.removeEventListener('beforeunload', unload);
    };
  }, [tab, result, busy]);
  const refresh = () =>
    api('/assistant/catalog').then((r) => {
      setObjects(r.objects);
      setCandidates(r.candidates);
    });
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    return () => {
      controller.current?.abort();
      if (reviewToken.current)
        assistantWrite('cancel', { token: reviewToken.current }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    let live = true;
    setEstimate(null);
    if ((tab === 'ask' || tab === 'structure') && keys.length && (tab !== 'ask' || question.trim()))
      assistantWrite('estimate', { mode, keys, question,space })
        .then((r) => {
          if (live) setEstimate(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [keys, question, tab]);
  const toggle = (xs: string[], id: string) =>
    xs.includes(id) ? xs.filter((k) => k !== id) : [...xs, id];
  const action = async (fn: () => Promise<void>) => {
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
  const changeTab = async (next: string) => {
    controller.current?.abort();
    if (result?.token) await assistantWrite('cancel', { token: result.token }).catch(() => {});
    setTab(next);
    setKeys([]);
    setResult(null);
    setDiff(null);
    setSelected([]);
    setError('');
    setNotice('');
  };
  const patch = (n: number, key: string, value: string) => {
    setDiff(null);
    setResult((r: any) => ({
      ...r,
      suggestion: {
        ...r.suggestion,
        suggestions: r.suggestion.suggestions.map((s: any, i: number) =>
          i === n ? { ...s, [key]: value } : s,
        ),
      },
    }));
  };
  const generate = () =>
    action(async () => {
      if (!confirm('仅发送当前选中的 ' + keys.length + ' 份资料给云端 AI？可能产生 API 费用。'))
        return;
      const c = new AbortController();
      controller.current = c;
      try {
        const r = await assistantWrite('generate', { mode, keys, question,space }, c.signal);
        setResult(r);
        setSelected([]);
        setDiff(null);
      } catch (e) {
        if (c.signal.aborted) throw Error('已取消，原资料未改变。');
        throw e;
      } finally {
        controller.current = null;
      }
    });
  const shown =
    tab === 'ask'
      ? matches
      : !filter && result
        ? objects.filter((o) => keys.includes(o.key))
        : objects
            .filter((o) =>
              !filter
                ? candidates.some((c) => c.key === o.key || c.target === o.key)
                : o.name.toLowerCase().includes(filter.toLowerCase()),
            )
            .slice(0, 80);
  return (
    <div className="assistant-workspace">
      <div className="knowledge-hero">
        <div>
          <div className="eyebrow">LOCAL EVIDENCE · HUMAN REVIEW</div>
          <h1>知识助手</h1><label>知识空间 <select value={space} onChange={e=>{setSpace(e.target.value);setKeys([]);setMatches([]);setResult(null);}}><option value="personal">个人知识</option><option value="professional">专业知识</option><option value="all">两者</option></select></label>
          <p>先检索、选证据，再生成回答或管理建议。原资料始终保留，AI 推断需要核对。</p>
        </div>
        <button
          onClick={() =>
            action(async () => {
              setHistory(await api('/assistant/history'));
              setHistoryOpen(true);
            })
          }
        >
          结构变更历史
        </button>
      </div>
      <div className="assistant-tabs" role="tablist">
        {[
          ['ask', '知识问答'],
          ['structure', 'AI 整理知识结构'],
          ['integrate', '跨范围整合'],
        ].map(([id, name]) => (
          <button role="tab" aria-selected={tab === id} key={id} onClick={() => changeTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="reader-hint">{notice}</p>}
      {tab === 'ask' && (
        <section className="assistant-question">
          <label>
            你的问题
            <textarea
              aria-label="知识助手问题"
              maxLength={1000}
              rows={3}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setResult(null);
              }}
              placeholder="例如：研究中有哪些实验观察？还有什么需要验证？"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !question.trim()}
            onClick={() =>
              action(async () => {
                const r = await assistantWrite('search', { question, space });
                setMatches(r.items);
                setKeys(
                  r.items
                    .filter((o: ObjectInfo) => o.hasEvidence)
                    .slice(0, 6)
                    .map((o: ObjectInfo) => o.key),
                );
                setResult(null);
                setNotice(
                  r.items.length
                    ? r.notice
                    : '没有匹配资料。请换用更具体的关键词，AI 不会伪造来源。',
                );
              })
            }
          >
            本地检索证据
          </button>
        </section>
      )}
      {tab === 'structure' && (
        <section>
          <h2>本地结构检查</h2>
          <p>先选择需要审查的原对象和可能的目标对象，最多30个；不会默认上传全库。</p>
          <div className="assistant-local-candidates">
            {candidates.slice(0, 30).map((c, n) => (
              <button
                key={n}
                onClick={() => {
                  setKeys([...new Set([...keys, c.key, ...(c.target ? [c.target] : [])])]);
                  setFilter('');
                }}
              >
                {objects.find((o) => o.key === c.key)?.name} · {c.reason}
              </button>
            ))}
            {!candidates.length && <p>未发现明显问题；可手动选择结构进行审查。</p>}
          </div>
          <input
            aria-label="筛选结构对象"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="筛选领域、标签、专题或内容…"
          />
        </section>
      )}
      {(tab === 'ask' || tab === 'structure') && (
        <>
          <div className="assistant-evidence-heading">
            <h2>
              {tab === 'ask' ? '本次检索资料' : '可选原对象与目标对象'} · {keys.length} 已选
            </h2>
            <button onClick={() => setKeys([])}>清空证据选择</button>
          </div>
          <div className="assistant-evidence-grid">
            {shown.slice(0, 80).map((o) => (
              <label className="assistant-evidence" key={o.key}>
                <input
                  type="checkbox"
                  aria-label={'证据 ' + o.name}
                  checked={keys.includes(o.key)}
                  onChange={() => {
                    setKeys(toggle(keys, o.key));
                    setResult(null);
                    setDiff(null);
                  }}
                />
                <div>
                  <strong>{o.name}</strong>
                  <small>
                    {kindLabels[o.kind]} ·{' '}
                    {o.hasEvidence ? '有文字/结构依据' : '仅标题或网址，不能作正文证据'} · 关联{' '}
                    {o.count}
                  </small>
                  <p>{o.excerpt || '未提供可用正文。'}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(o.key);
                    }}
                  >
                    查看站内来源
                  </button>
                </div>
              </label>
            ))}
          </div>
          {estimate && (
            <div className="integration-estimate">
              {estimate.chars} 字符 / 约 {estimate.tokens} 输入 Token · {estimate.provider} /{' '}
              {estimate.model} · 输入参考 ${estimate.estimatedUSD.toFixed(6)}
              ，输出另计。上限12000字符，超长请调整证据范围。
              {estimate.insufficient && <p>所选资料不足，无法生成有依据的结果。</p>}
            </div>
          )}
          <div className="assistant-generate">
            <button className="primary" disabled={busy || !estimate} onClick={generate}>
              {busy ? '生成中…' : tab === 'ask' ? '根据所选证据回答' : '生成结构优化建议'}
            </button>
            {busy && <button onClick={() => controller.current?.abort()}>取消生成</button>}
          </div>
        </>
      )}
      {result && tab === 'ask' && (
        <section className="assistant-answer">
          <h2>基于所选资料的回答</h2>
          {result.suggestion.answer.map((a: any, n: number) => (
            <article key={n}>
              <span className="knowledge-candidate">
                {a.basis === 'evidence' ? '已有资料，仍需核对' : '模型推断，尚未确认'}
              </span>
              <p>{a.text}</p>
              <div className="chips">
                {a.sourceIds.map((key: string) => (
                  <button key={key} onClick={() => onOpen(key)}>
                    {result.sources.find((s: any) => s.key === key)?.name || key}
                  </button>
                ))}
              </div>
            </article>
          ))}
          {result.suggestion.missing.length > 0 && (
            <>
              <h3>资料不足 / 待验证</h3>
              <ul>
                {result.suggestion.missing.map((s: string, n: number) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            回答未保存为知识，更没有标为人工确认。引用指向站内资料，网址内容未自动读取。
          </p>
          {result.usage && (
            <p>
              实际 {result.usage.inputTokens} / {result.usage.outputTokens} Token · 参考 $
              {result.usage.estimatedUSD}
            </p>
          )}
        </section>
      )}
      {result && tab === 'structure' && (
        <section className="assistant-review">
          <h2>统一审核 · 结构建议</h2>
          {result.suggestion.missing.map((s: string, n: number) => (
            <p key={n}>{s}</p>
          ))}
          {result.suggestion.suggestions.map((s: any, n: number) => {
            const original = objects.find((o) => o.key === s.object),
              destination = objects.find((o) => o.key === s.target);
            return (
              <AiReviewItem
                key={n}
                title={actions[s.action] + ' · ' + (original?.name || '新对象')}
                before={
                  original
                    ? original.name +
                      ' · 当前归属 ' +
                      (objects.find((o) => o.id === (original.parent || original.directory))
                        ?.name || '独立 / 根级')
                    : '不存在'
                }
                after={s.name || destination?.name || actions[s.action]}
                reason={s.reason}
                affected={original?.count || 0}
                relationChange={['merge', 'move', 'associate'].includes(s.action)}
                contentChange={s.action === 'merge' && s.kind === 'collections'}
              >
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={'采用结构建议 ' + n}
                    checked={selected.includes(n)}
                    onChange={() => {
                      setSelected(
                        selected.includes(n) ? selected.filter((i) => i !== n) : [...selected, n],
                      );
                      setDiff(null);
                    }}
                  />
                  采用此条
                </label>
                <div className="knowledge-fields">
                  <label>
                    操作
                    <select
                      aria-label={'结构操作 ' + n}
                      value={s.action}
                      onChange={(e) => patch(n, 'action', e.target.value)}
                    >
                      {Object.entries(actions).map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    建议名称
                    <input
                      aria-label={'结构新名称 ' + n}
                      maxLength={50}
                      value={s.name}
                      onChange={(e) => patch(n, 'name', e.target.value)}
                    />
                  </label>
                  <label>
                    目标
                    <select
                      aria-label={'结构目标 ' + n}
                      value={s.target}
                      onChange={(e) => patch(n, 'target', e.target.value)}
                    >
                      <option value="">无目标 / 根领域</option>
                      {objects
                        .filter((o) => keys.includes(o.key))
                        .map((o) => (
                          <option key={o.key} value={o.key}>
                            {kindLabels[o.kind]} · {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    创建对象类型
                    <select
                      value={s.kind}
                      aria-label={'结构类型 ' + n}
                      onChange={(e) => patch(n, 'kind', e.target.value)}
                    >
                      {Object.entries(kindLabels)
                        .filter(([k]) => k !== 'directories')
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <textarea
                  aria-label={'结构理由 ' + n}
                  maxLength={600}
                  value={s.reason}
                  onChange={(e) => patch(n, 'reason', e.target.value)}
                />
                <small>
                  来源依据：
                  {s.evidenceIds
                    .map((key: string) => objects.find((o) => o.key === key)?.name || key)
                    .join('、')}
                </small>
              </AiReviewItem>
            );
          })}
          <button
            disabled={busy || !selected.length}
            onClick={() =>
              action(async () =>
                setDiff(
                  await assistantWrite('preview', {
                    token: result.token,
                    plan: result.suggestion,
                    selected,
                  }),
                ),
              )
            }
          >
            保存前差异预览
          </button>
          {diff && (
            <section className="review-final-diff">
              <h3>本次正式变更预览</h3>
              {diff.changes.map((c: any, n: number) => (
                <p key={n}>
                  {c.before?.name || '新对象'} →{' '}
                  {c.after.name || c.after.target?.name || actions[c.after.action]} · {c.affected}{' '}
                  个直接关联对象 · 目标关联 {c.targetAffected || 0} 个 ·{' '}
                  {c.contentChange ? '专题正文将保留并追加合并' : '原正文保留'} ·{' '}
                  {c.relationChange ? '调整关系' : '保留关系'}
                </p>
              ))}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    if (
                      !confirm('确认采用所选结构变更？服务端将重新校验并事务保存，可在历史中恢复。')
                    )
                      return;
                    const hasMerge = selected.some(
                      (n) => result.suggestion.suggestions[n].action === 'merge',
                    );
                    if (
                      hasMerge &&
                      !confirm(
                        '明确合并分类并保留引用？源分类将并入目标，专题正文和历史保留；有未保存草稿时拒绝。',
                      )
                    )
                      return;
                    await assistantWrite('apply', {
                      token: result.token,
                      plan: result.suggestion,
                      selected,
                      state: diff.state,
                      reviewHash: diff.reviewHash,
                      confirm: '采用结构变更',
                      mergeConfirm: hasMerge ? '合并分类并保留引用' : '',
                    });
                    setResult(null);
                    setDiff(null);
                    setKeys([]);
                    setNotice('已事务保存，原知识正文和来源保留。');
                    await refresh();
                    onChanged();
                  })
                }
              >
                确认保存结构变更
              </button>
            </section>
          )}
          <button
            onClick={() =>
              action(async () => {
                await assistantWrite('cancel', { token: result.token });
                setResult(null);
                setDiff(null);
              })
            }
          >
            拒绝本次方案
          </button>
        </section>
      )}
      {tab === 'integrate' && (
        <section>
          <h2>选择多个领域、文档或知识集合</h2>
          <p>只在本地展开范围，再选2～10条完整资料分析；不自动上传范围内所有知识。</p>
          <div className="assistant-evidence-grid">
            {objects
              .filter(
                (o) =>
                  o.kind === 'domains' ||
                  (o.kind === 'entries' &&
                    ['page', 'point', 'capture'].includes(o.entryKind || '')),
              )
              .map((o) => (
                <label className="assistant-evidence" key={o.key}>
                  <input
                    type="checkbox"
                    checked={scopeKeys.includes(o.key)}
                    aria-label={'整合范围 ' + o.name}
                    onChange={() => setScopeKeys(toggle(scopeKeys, o.key))}
                  />
                  {o.name} · {kindLabels[o.kind]}
                </label>
              ))}
          </div>
          <button
            disabled={busy || !scopeKeys.length}
            onClick={() =>
              action(async () => {
                const r = await assistantWrite('scope', { keys: scopeKeys });
                setScopeItems(r.items);
                setIds([]);
              })
            }
          >
            本地展开所选范围
          </button>
          {scopeItems.length > 0 && (
            <>
              <h3>从 {scopeItems.length} 条候选中选择资料</h3>
              {scopeItems.map((o) => (
                <label className="collect-row" key={o.key}>
                  <input
                    type="checkbox"
                    checked={ids.includes(o.id)}
                    aria-label={'整合知识 ' + o.name}
                    onChange={() => setIds(toggle(ids, o.id))}
                  />
                  <span>
                    {o.name}
                    <small>{o.excerpt}</small>
                  </span>
                </label>
              ))}
              <label>
                采用到页面
                <select
                  aria-label="整合目标页面"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">新建综合知识页面</option>
                  {objects
                    .filter((o) => o.entryKind === 'page')
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
              {!target && (
                <div className="knowledge-fields">
                  <label>
                    新页面标题
                    <input
                      aria-label="新综合页面标题"
                      value={newTitle}
                      maxLength={200}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    主要领域
                    <select
                      aria-label="新综合页面领域"
                      value={newDir}
                      onChange={(e) => setNewDir(e.target.value)}
                    >
                      <option value="">暂不指定</option>
                      {objects
                        .filter((o) => o.kind === 'domains')
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              <button
                className="primary"
                disabled={ids.length < 2 || ids.length > 10 || (!target && !newTitle.trim())}
                onClick={() => setIntegrationOpen(true)}
              >
                审核跨来源整合 ({ids.length})
              </button>
            </>
          )}
        </section>
      )}
      {integrationOpen && (
        <KnowledgeIntegration
          ids={ids}
          pageId={target}
          newPage={
            !target ? { title: newTitle, directory_id: null, domain_id: newDir || null } : undefined
          }
          onClose={() => setIntegrationOpen(false)}
          onApplied={(id) => {
            setIntegrationOpen(false);
            refresh();
            onChanged();
            if (id) onOpen('entries:' + id);
          }}
        />
      )}
      {historyOpen && (
        <Dialog title="结构变更历史" wide onClose={() => setHistoryOpen(false)}>
          <div className="knowledge-import">
            <p>
              恢复只允许知识库仍与该批次提交后完全一致；后续有编辑/导入/关系变化时拒绝，避免覆盖新成果。
            </p>
            {history.map((r) => (
              <section key={r.id}>
                <h3>
                  {r.created_at} · {r.changes.length} 条变更
                </h3>
                {r.changes.map((c: any, n: number) => (
                  <p key={n}>
                    {c.before?.name || '新对象'} →{' '}
                    {c.after.name || c.after.target?.name || actions[c.after.action]}
                  </p>
                ))}
                <button
                  onClick={() =>
                    action(async () => {
                      if (!confirm('恢复这一批结构变更？恢复前会再次核对当前知识库。')) return;
                      await assistantWrite('restore', { id: r.id, confirm: '恢复结构变更' });
                      setHistory(await api('/assistant/history'));
                      await refresh();
                      onChanged();
                    })
                  }
                >
                  恢复该批次
                </button>
              </section>
            ))}
            {!history.length && <p>尚无已保存结构变更。</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
