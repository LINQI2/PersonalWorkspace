import { useEffect, useState } from 'react';
import { Dialog } from './components';
import { api, labels, type Kind } from './shared';
import { knowledgeWrite } from './knowledgeTypes';
export const contentLabels: Record<string, string> = {
  mindmap: '思维导图',
  note: '笔记',
  bookmark: '网站收藏',
  tool: '工具',
  document: '综合文档',
  block: '文档知识块',
  unspecified: '请选择类型',
};
export function UnifiedImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [raw, setRaw] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [reviews, setReviews] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [approved, setApproved] = useState<string[]>([]),
    [nodes, setNodes] = useState<string[]>([]),
    [repeat, setRepeat] = useState(false),
    [relations, setRelations] = useState(false),
    [duplicates, setDuplicates] = useState(false),
    [legacy, setLegacy] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (raw) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [raw]);
  const patch = (id: string, p: any) =>
    setReviews((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const toggle = (rs: string[], id: string) =>
    rs.includes(id) ? rs.filter((x) => x !== id) : [...rs, id];
  const close = async () => {
    if (busy || (raw && !confirm('取消导入？尚未保存的审核将清空。'))) return;
    if (preview)
      await knowledgeWrite('/import/cancel', 'POST', { token: preview.token }).catch(() => {});
    onClose();
  };
  const run = async (fn: () => Promise<void>) => {
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
  const chosen = reviews.filter((r) => selected.includes(r.id)),
    seen = new Set<string>(),
    hierarchy: { item: any; depth: number }[] = [];
  const walk = (item: any, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    hierarchy.push({ item, depth });
    chosen.filter((r) => r.parent === item.id).forEach((r) => walk(r, Math.min(depth + 1, 8)));
  };
  chosen
    .filter((r) => !r.parent || !chosen.some((p) => p.id === r.parent))
    .forEach((r) => walk(r, 0));
  chosen.filter((r) => !seen.has(r.id)).forEach((r) => walk(r, 0));
  return (
    <Dialog title="统一内容导入与审核" wide onClose={close}>
      <div className="unified-import">
        <p className="muted">
          JSON v2 明确区分四类内容与内部章节；512 KiB /
          100条。全部在本机解析，原始包和来源保留，不调用AI。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!preview ? (
          <>
            <div className="knowledge-actions">
              {['template', 'schema'].map((f) => (
                <button
                  key={f}
                  onClick={() =>
                    run(async () => {
                      const data = await api('/library/' + f);
                      const u = URL.createObjectURL(
                        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                      );
                      const a = document.createElement('a');
                      a.href = u;
                      a.download = 'content-v2-' + f + '.json';
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(u), 10000);
                    })
                  }
                >
                  {f === 'schema' ? '下载v2 Schema' : '下载v2示例'}
                </button>
              ))}
            </div>
            <label>
              选择文件
              <input
                aria-label="统一导入文件"
                type="file"
                accept=".json,.txt,.md"
                onChange={(e) =>
                  run(async () => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 512 * 1024) throw Error('文件超过512 KiB。');
                    setRaw(await f.text());
                  })
                }
              />
            </label>
            <textarea
              aria-label="统一导入原文"
              rows={12}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="粘贴 JSON v2；旧v1选择下方兼容转换。Markdown/纯文本将保留为一条原始笔记。"
            />
            <label>
              <input
                type="checkbox"
                checked={legacy}
                onChange={(e) => setLegacy(e.target.checked)}
              />
              确认将旧v1/纯文本转换到统一结构，审核后再保存。旧目录仅提供领域建议，不自动创建。
            </label>
            <button
              className="primary"
              disabled={busy || !raw.trim()}
              onClick={() =>
                run(async () => {
                  let format = 'json';
                  try {
                    const v = JSON.parse(raw);
                    if (v.version === 1 && !legacy) throw Error('旧v1需要明确选择兼容转换。');
                  } catch (e) {
                    if (raw.trim().startsWith('{')) throw e;
                    format = 'text';
                    if (!legacy) throw Error('纯文本需要确认保留为原始笔记。');
                  }
                  const p = await knowledgeWrite('/import/preview', 'POST', {
                    raw,
                    format,
                    convertLegacy: legacy,
                  });
                  if (p.version !== 2) throw Error('请选择兼容转换后重试。');
                  setPreview(p);
                  setSelected(p.items.map((i: any) => i.id));
                  setReviews(
                    p.items.map((i: any) => ({
                      id: i.id,
                      title: i.title,
                      body: i.body,
                      body_format: i.body_format || 'plain',
                      content_type: i.content_type,
                      url: i.url || '',
                      description: i.description || '',
                      tool_kind: i.tool_kind || 'other',
                      parent: i.parent || null,
                      primary_domain_id: null,
                      ...Object.fromEntries(
                        (['domains', 'tags', 'collections'] as Kind[]).map((k) => [
                          k,
                          (i[k] || [])
                            .map((n: string) => p.taxonomy[k].find((t: any) => t.name === n)?.id)
                            .filter(Boolean),
                        ]),
                      ),
                    })),
                  );
                })
              }
            >
              {busy ? '解析中…' : '本地解析并预览'}
            </button>
          </>
        ) : (
          <>
            <p>{preview.notice}</p>
            <details>
              <summary>查看原始包及全部来源</summary>
              <pre>{raw}</pre>
            </details>
            {!!preview.repeated.length && (
              <label className="draft-banner">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                />
                检测到重复导入，确认另存所选内容（不会合并旧记录）
              </label>
            )}
            <section className="hierarchy-preview">
              <h3>最终内容与章节层级</h3>
              {hierarchy.map(({ item: r, depth }) => (
                <div key={r.id} style={{ paddingLeft: depth * 20 }}>
                  {contentLabels[r.content_type]} · {r.title}
                  {r.parent && !selected.includes(r.parent) && (
                    <strong className="error"> 父级未选中</strong>
                  )}
                </div>
              ))}
            </section>
            {!!preview.relations.length && (
              <details>
                <summary>包内关联候选（{preview.relations.length}条）</summary>
                {preview.relations.map((r: any, i: number) => (
                  <p key={i}>
                    {preview.items.find((x: any) => x.id === r.from)?.title} →{' '}
                    {preview.items.find((x: any) => x.id === r.to)?.title} · {r.kind} · {r.note}
                    {!selected.includes(r.from) || !selected.includes(r.to)
                      ? '（两端未同时选择，本次不写入；原始包保留）'
                      : ''}
                  </p>
                ))}
              </details>
            )}
            {reviews.map((r) => (
              <details className="import-review-card" key={r.id} open={selected.includes(r.id)}>
                <summary>
                  {r.title} · {contentLabels[r.content_type]}
                </summary>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={() => setSelected(toggle(selected, r.id))}
                  />
                  导入此内容
                </label>
                <div className="unified-form-grid">
                  <label>
                    内容类型
                    <select
                      aria-label={'类型 ' + r.id}
                      value={r.content_type}
                      onChange={(e) =>
                        patch(r.id, {
                          content_type: e.target.value,
                          ...(e.target.value !== 'block' ? { parent: null } : {}),
                        })
                      }
                    >
                      {Object.entries(contentLabels)
                        .filter(([k]) => k !== 'mindmap')
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    标题
                    <input
                      aria-label={'标题 ' + r.id}
                      maxLength={200}
                      value={r.title}
                      onChange={(e) => patch(r.id, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    网址（改变类型不会移除原始包的网址）
                    <input
                      aria-label={'网址 ' + r.id}
                      value={r.url}
                      onChange={(e) => patch(r.id, { url: e.target.value })}
                    />
                  </label>
                  <label>
                    用途 / 简介
                    <input
                      maxLength={2000}
                      value={r.description}
                      onChange={(e) => patch(r.id, { description: e.target.value })}
                    />
                  </label>
                  {r.content_type === 'tool' && (
                    <label>
                      工具类型
                      <select
                        value={r.tool_kind}
                        onChange={(e) => patch(r.id, { tool_kind: e.target.value })}
                      >
                        {['website', 'online', 'ai', 'desktop', 'custom', 'other'].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {r.content_type === 'block' && (
                    <label>
                      文档 / 上级章节
                      <select
                        aria-label={'父级 ' + r.id}
                        value={r.parent || ''}
                        onChange={(e) => patch(r.id, { parent: e.target.value || null })}
                      >
                        <option value="">请选择归属</option>
                        {reviews
                          .filter(
                            (x) => x.id !== r.id && ['document', 'block'].includes(x.content_type),
                          )
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
                <label>
                  正文（原格式保留；HTML保存前校验）
                  <textarea
                    aria-label={'正文 ' + r.id}
                    rows={5}
                    value={r.body}
                    onChange={(e) => patch(r.id, { body: e.target.value })}
                  />
                </label>
                {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
                  <label key={k}>
                    {labels[k]}
                    <select
                      multiple
                      aria-label={k + ' ' + r.id}
                      value={r[k]}
                      onChange={(e) =>
                        patch(r.id, {
                          [k]: Array.from(e.target.selectedOptions).map((o) => o.value),
                        })
                      }
                    >
                      {preview.taxonomy[k].map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  主要领域
                  <select
                    aria-label={'主要领域 ' + r.id}
                    value={r.primary_domain_id || ''}
                    onChange={(e) => patch(r.id, { primary_domain_id: e.target.value || null })}
                  >
                    <option value="">不指定 / 已确认建议领域</option>
                    {preview.taxonomy.domains
                      .filter((t: any) => r.domains.includes(t.id))
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="muted">
                  {preview.items.find((i: any) => i.id === r.id).epistemic || 'ai_inference'} ·
                  原始日期：{preview.items.find((i: any) => i.id === r.id).original_date || '未知'}
                  。导入不代表人工确认。
                </p>
                {(preview.candidates.find((c: any) => c.id === r.id)?.matches || []).map(
                  (m: any) => (
                    <p key={m.id}>
                      疑似重复：{m.title} · {m.reason}。不自动合并。
                    </p>
                  ),
                )}
              </details>
            ))}
            <h3>创建建议（默认不创建）</h3>
            {preview.domainSuggestions.map((d: any) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={nodes.includes(d.id)}
                  onChange={() => setNodes(toggle(nodes, d.id))}
                />
                创建领域 {d.name}
                {d.parent
                  ? ' / 父级 ' + preview.domainSuggestions.find((x: any) => x.id === d.parent)?.name
                  : ''}
              </label>
            ))}
            {(['domains', 'tags', 'collections'] as Kind[]).flatMap((k) =>
              [
                ...new Set<string>(
                  preview.items
                    .filter((i: any) => selected.includes(i.id))
                    .flatMap((i: any) => i[k] || []),
                ),
              ]
                .filter((n) => !preview.taxonomy[k].some((t: any) => t.name === n))
                .map((n) => (
                  <label key={k + n}>
                    <input
                      type="checkbox"
                      checked={approved.includes(k + '\n' + n)}
                      onChange={() => setApproved(toggle(approved, k + '\n' + n))}
                    />
                    创建{labels[k]} {n}
                  </label>
                )),
            )}
            <label>
              <input
                type="checkbox"
                checked={relations}
                onChange={(e) => setRelations(e.target.checked)}
              />
              保留包内关联建议（候选，不自动确认）
            </label>
            <label>
              <input
                type="checkbox"
                checked={duplicates}
                onChange={(e) => setDuplicates(e.target.checked)}
              />
              如网址已存在，明确另存副本，不覆盖旧收藏
            </label>
            <div className="form-footer">
              <button disabled={busy} onClick={close}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !selected.length || (preview.repeated.length && !repeat)}
                onClick={() =>
                  run(async () => {
                    if (!confirm('确认新增所选内容和已勾选分类？不覆盖现有资料。')) return;
                    await knowledgeWrite('/import/commit', 'POST', {
                      token: preview.token,
                      confirm: '确认导入所选知识',
                      items: reviews.filter((r) => selected.includes(r.id)),
                      approvedDomains: nodes,
                      approvedTaxonomy: approved.map((s) => {
                        const [kind, name] = s.split('\n');
                        return { kind, name };
                      }),
                      includeRelations: relations,
                      allowDuplicateUrls: duplicates,
                      repeat: repeat ? '另存所选知识' : '',
                    });
                    setRaw('');
                    onImported();
                  })
                }
              >
                {busy ? '保存中…' : '确认写入所选内容'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
