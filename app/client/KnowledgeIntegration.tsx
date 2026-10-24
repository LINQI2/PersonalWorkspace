import { useEffect, useRef, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import { knowledgeWrite } from './knowledgeTypes';
import { AiReviewItem } from './AiReviewItem';
const labels: Record<string, string> = {
  duplicate: '完全重复',
  complement: '内容互补',
  parent: '上下级',
  conflict: '观点冲突',
  revision: '判断修正',
  related: '仅相关，保持独立',
};
export function KnowledgeIntegration({
  ids,
  pageId,
  onClose,
  onApplied,
  newPage,
}: {
  ids: string[];
  pageId: string;
  onClose: () => void;
  onApplied: (pageId?: string) => void;
  newPage?: { title: string; directory_id: string | null; domain_id?: string | null };
}) {
  const [estimate, setEstimate] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [sections, setSections] = useState<number[]>([]),
    [relations, setRelations] = useState<number[]>([]),
    [order, setOrder] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    knowledgeWrite('/integration/estimate', 'POST', { ids, pageId })
      .then(setEstimate)
      .catch((e) => setError(e.message));
    return () => controller.current?.abort();
  }, []);
  const close = async () => {
    controller.current?.abort();
    if (result?.token)
      await knowledgeWrite('/integration/cancel', 'POST', { token: result.token }).catch(() => {});
    onClose();
  };
  const toggle = (xs: number[], n: number) =>
    xs.includes(n) ? xs.filter((i) => i !== n) : [...xs, n];
  const source = (id: string) => result?.snapshots?.find((s: any) => s.id === id)?.title || id;
  const patchSection = (n: number, key: string, value: string) =>
    setResult((r: any) => ({
      ...r,
      suggestion: {
        ...r.suggestion,
        sections: r.suggestion.sections.map((s: any, i: number) =>
          i === n ? { ...s, [key]: value } : s,
        ),
      },
    }));
  const patchRelation = (n: number, key: string, value: string) =>
    setResult((r: any) => ({
      ...r,
      suggestion: {
        ...r.suggestion,
        relations: r.suggestion.relations.map((s: any, i: number) =>
          i === n ? { ...s, [key]: value } : s,
        ),
      },
    }));
  return (
    <Dialog title="知识整合方案 · 人工审核" wide onClose={close}>
      <div className="knowledge-import">
        <p>只分析选中资料，不访问网址。原知识不删除、不覆盖；采用的章节另存为 AI 推断 / 待验证。</p>
        {estimate && (
          <div className="integration-estimate">
            <strong>
              {ids.length} 条 · {estimate.chars} 字符 · 估计 {estimate.estimatedTokens} 输入 Token
            </strong>
            <p>
              {estimate.provider} / {estimate.model} · 上限 {estimate.maxChars}{' '}
              字符。实际用量及参考费用以调用记录为准；收费依所选 Provider。
              {estimate.estimatedUSD != null &&
                '本次输入参考 $' + estimate.estimatedUSD.toFixed(6) + '，另计输出。'}
            </p>
            <small>过长资料会拒绝，需自行缩小可审查的选择范围；不会静默截断。</small>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {estimate?.candidates?.length > 0 && (
          <details>
            <summary>本地相似候选 · {estimate.candidates.length}（尚未判断）</summary>
            {estimate.candidates.map((c: any, n: number) => (
              <p key={n}>
                {c.fromTitle} / {c.toTitle} · {c.reason}
              </p>
            ))}
          </details>
        )}
        {!result && (
          <button
            className="primary"
            disabled={busy || !estimate}
            onClick={async () => {
              if (!confirm('主动调用云端 AI 分析这 ' + ids.length + ' 条资料？可能产生 API 费用。'))
                return;
              setBusy(true);
              setError('');
              const c = new AbortController();
              controller.current = c;
              try {
                const session = await api('/local/session');
                const r = await api('/knowledge/integration/generate', {
                  method: 'POST',
                  headers: { 'X-PK-Session': session.token },
                  body: JSON.stringify({ ids, pageId }),
                  signal: c.signal,
                });
                setResult(r);
                setSections(r.suggestion.sections.map((_: any, n: number) => n));
              } catch (e) {
                setError(c.signal.aborted ? '已取消，原知识未改变。' : (e as Error).message);
              } finally {
                setBusy(false);
                controller.current = null;
              }
            }}
          >
            {busy ? '正在分析…' : '生成候选整合方案'}
          </button>
        )}
        {busy && <button onClick={() => controller.current?.abort()}>取消生成</button>}
        {result && (
          <>
            <p className="knowledge-candidate">
              {result.suggestion.reason || '候选方案，尚未写入正式知识。'}
            </p>
            {result.usage && (
              <p>
                实际 Token：{result.usage.inputTokens} / {result.usage.outputTokens} · 参考 $
                {result.usage.estimatedUSD}
              </p>
            )}
            {result.usageWarning && <p role="alert">{result.usageWarning}</p>}
            {result.fromCache && <p>复用 15 分钟内的相同资料快照方案，本次未调用 API。</p>}
            <h3>建议保持独立</h3>
            <ul>
              {result.suggestion.keepIds.map((id: string) => (
                <li key={id}>{source(id)}</li>
              ))}
            </ul>
            <h3>候选章节（可修改或拒绝）</h3>
            {result.suggestion.sections.map((s: any, n: number) => (
              <AiReviewItem
                key={n}
                title="候选整合章节"
                before="所选原知识保持独立"
                after={(newPage?.title || '目标页面') + ' → ' + s.title}
                reason="整合稿独立保存，原文、不同阶段判断和来源保留。"
                affected={s.sourceIds.length}
                contentChange={true}
                relationChange={true}
              >
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={'采用整合章节 ' + n}
                    checked={sections.includes(n)}
                    onChange={() => setSections(toggle(sections, n))}
                  />
                  采用此章节
                </label>
                <input
                  aria-label={'整合章节标题 ' + n}
                  maxLength={200}
                  value={s.title}
                  onChange={(e) => patchSection(n, 'title', e.target.value)}
                />
                <textarea
                  aria-label={'整合章节正文 ' + n}
                  maxLength={4000}
                  value={s.text}
                  onChange={(e) => patchSection(n, 'text', e.target.value)}
                />
                <small>来源：{s.sourceIds.map(source).join('、')}</small>
                <p>依据原文保持独立，可在页面中展开来源逐条对照。</p>
              </AiReviewItem>
            ))}
            <h3>重复、互补与冲突依据</h3>
            {result.suggestion.relations.map((r: any, n: number) => (
              <section className="knowledge-review-item" key={n}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={relations.includes(n)}
                    disabled={r.kind === 'related'}
                    onChange={() => setRelations(toggle(relations, n))}
                  />
                  {labels[r.kind]} · {source(r.from)} → {source(r.to)}
                </label>
                <select
                  aria-label={'关系类型 ' + n}
                  value={r.kind}
                  onChange={(e) => patchRelation(n, 'kind', e.target.value)}
                >
                  {Object.entries(labels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <textarea
                  aria-label={'关系依据说明 ' + n}
                  value={r.reason}
                  maxLength={400}
                  onChange={(e) => patchRelation(n, 'reason', e.target.value)}
                />
                <blockquote>{r.fromQuote}</blockquote>
                <blockquote>{r.toQuote}</blockquote>
                <small>采用后仍为关系候选，不合并原文。仅相关建议不写成强关系。</small>
              </section>
            ))}
            <h3>建议阅读顺序</h3>
            <ol>
              {result.suggestion.order.map((id: string, n: number) => (
                <li key={id}>
                  {source(id)}{' '}
                  <button
                    aria-label={'调整建议顺序 ' + source(id)}
                    disabled={n === 0}
                    onClick={() =>
                      setResult((r: any) => {
                        const ids = [...r.suggestion.order];
                        [ids[n - 1], ids[n]] = [ids[n], ids[n - 1]];
                        return { ...r, suggestion: { ...r.suggestion, order: ids } };
                      })
                    }
                  >
                    上移
                  </button>
                </li>
              ))}
            </ol>
            <label className="check-label">
              <input type="checkbox" checked={order} onChange={(e) => setOrder(e.target.checked)} />
              采用直属章节阅读顺序（不改变父级）
            </label>
            <h3>待验证</h3>
            <ul>
              {result.suggestion.verification.map((s: string, n: number) => (
                <li key={n}>{s}</li>
              ))}
            </ul>
            <div className="form-footer">
              <button onClick={close}>拒绝并关闭</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  result.suggestion.status !== 'ready' ||
                  (!sections.length && !relations.length && !order)
                }
                onClick={async () => {
                  if (!confirm('采用所选整合建议？新增章节保留原文，关系仍是候选。')) return;
                  setBusy(true);
                  try {
                    const applied = await knowledgeWrite('/integration/apply', 'POST', {
                      token: result.token,
                      plan: result.suggestion,
                      sections,
                      relations,
                      adoptOrder: order,
                      pageId,
                      newPage,
                      confirm: '采用所选整合建议',
                    });
                    onApplied(applied.pageId);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                采用所选建议
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
