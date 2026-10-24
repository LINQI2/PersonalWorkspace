import { useState } from 'react';
import { Dialog } from './components';
import { api, labels, type Kind } from './shared';
import {
  knowledgeWrite,
  knowledgeLabels,
  stateLabels,
  epistemicLabels,
  sourceLabels,
  directoryLabel,
  type Directory,
} from './knowledgeTypes';
type Item = {
  id: string;
  title: string;
  body: string;
  body_format: 'plain' | 'html';
  kind: keyof typeof knowledgeLabels;
  status: keyof typeof stateLabels;
  epistemic: keyof typeof epistemicLabels;
  priority: number;
  questions: string;
  original_date: string | null;
  provided_recorded_at: string | null;
  date_note: string;
  directory_id: string | null;
  domains: string[];
  tags: string[];
  collections: string[];
  confirm?: string;
  parent?: string | null;
};
type Preview = {
  token: string;
  items: any[];
  sources: any[];
  directories: { id: string; name: string; parent?: string }[];
  relations: any[];
  taxonomy: Record<Kind, { id: string; name: string }[]>;
  existingDirectories: Directory[];
  candidates: { id: string; matches: { id: string; title: string; reason: string }[] }[];
  repeated: { id: string; recorded_at: string }[];
  notice: string;
};
export function KnowledgeImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [raw, setRaw] = useState(''),
    [format, setFormat] = useState('json'),
    [preview, setPreview] = useState<Preview | null>(null),
    [reviews, setReviews] = useState<Item[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [approvedTax, setApprovedTax] = useState<string[]>([]),
    [approvedDirs, setApprovedDirs] = useState<string[]>([]),
    [relations, setRelations] = useState(false),
    [existingRelations, setExistingRelations] = useState<string[]>([]),
    [repeat, setRepeat] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const close = async () => {
    if (busy) return;
    if (raw && !confirm('取消本次导入？尚未写入的审核内容将清空。')) return;
    if (preview)
      await knowledgeWrite('/import/cancel', 'POST', { token: preview.token }).catch(() => {});
    onClose();
  };
  const patch = (id: string, p: Partial<Item>) =>
    setReviews((rows) => rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const toggle = (rows: string[], id: string) =>
    rows.includes(id) ? rows.filter((v) => v !== id) : [...rows, id];
  const unknown = preview
    ? (['domains', 'tags', 'collections'] as Kind[]).flatMap((k) =>
        [
          ...new Set(
            preview.items.filter((i) => selected.includes(i.id)).flatMap((i) => i[k] || []),
          ),
        ]
          .filter((name) => !preview.taxonomy[k].some((t) => t.name === name))
          .map((name) => ({ kind: k, name: String(name), key: k + '\n' + name })),
      )
    : [];
  const hierarchy: { item: Item; depth: number; invalid?: string }[] = [];
  const chosen = reviews.filter((r) => selected.includes(r.id)),
    seen = new Set<string>();
  const walk = (item: Item, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    let key = item.parent;
    const path = new Set([item.id]);
    let root = item;
    while (key && !path.has(key) && path.size <= 8) {
      path.add(key);
      const parent = chosen.find((r) => r.id === key);
      if (!parent) break;
      root = parent;
      key = parent.parent;
    }
    const invalid = item.parent
      ? key
        ? '父级缺失、循环或超层级'
        : root.kind !== 'page'
          ? '章节需最终归属于页面'
          : undefined
      : undefined;
    hierarchy.push({ item, depth, invalid });
    chosen.filter((r) => r.parent === item.id).forEach((r) => walk(r, Math.min(depth + 1, 8)));
  };
  chosen
    .filter((r) => !r.parent || !chosen.some((p) => p.id === r.parent))
    .forEach((r) => walk(r, 0));
  chosen.filter((r) => !seen.has(r.id)).forEach((r) => walk(r, 0));
  return (
    <Dialog title="导入与人工审核" wide onClose={close}>
      <div className="knowledge-import">
        <p className="muted">
          本地解析与人工审核，512 KiB / 100
          条上限。下载示例后替换为自己的资料；Markdown/纯文本保留为单条原始收集，不猜测拆分。
        </p>
        {!preview ? (
          <>
            <div className="knowledge-import-input">
              {(
                [
                  ['template', '下载示例模板'],
                  ['schema', '下载格式 Schema'],
                ] as const
              ).map(([file, label]) => (
                <button
                  key={file}
                  type="button"
                  onClick={async () => {
                    try {
                      const data = await api('/knowledge/' + file);
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                      );
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'knowledge-' + file + '.json';
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 10000);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
              <select
                aria-label="导入格式"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="json">标准 JSON</option>
                <option value="markdown">Markdown 原始资料</option>
                <option value="text">纯文本原始资料</option>
              </select>
              <label className="button">
                选择文件
                <input
                  type="file"
                  aria-label="知识导入文件"
                  accept=".json,.md,.txt"
                  disabled={busy}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 512 * 1024) {
                      setError('文件超过 512 KiB，不会读取或截断。');
                      return;
                    }
                    setRaw(await f.text());
                    setFormat(
                      f.name.endsWith('.json')
                        ? 'json'
                        : f.name.endsWith('.md')
                          ? 'markdown'
                          : 'text',
                    );
                  }}
                />
              </label>
            </div>
            <textarea
              aria-label="知识导入原文"
              rows={14}
              maxLength={524288}
              value={raw}
              placeholder="粘贴符合 Schema 的 JSON；或切换为单条原始资料"
              onChange={(e) => setRaw(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy || !raw.trim()}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const p = await knowledgeWrite<Preview>('/import/preview', 'POST', {
                    raw,
                    format,
                  });
                  setPreview(p);
                  setSelected(p.items.map((i) => i.id));
                  setReviews(
                    p.items.map((i) => ({
                      id: i.id,
                      title: i.title,
                      body: i.body,
                      body_format: i.body_format || 'plain',
                      kind: i.kind || 'point',
                      status: i.status || 'review',
                      epistemic: i.epistemic || 'ai_inference',
                      priority: i.priority || 0,
                      questions: (i.questions || []).join('\n'),
                      original_date: i.original_date || null,
                      provided_recorded_at: i.recorded_at || null,
                      date_note: i.date_note || '',
                      directory_id: null,
                      parent: (() => {
                        let key = i.parent;
                        const seen = new Set();
                        while (key && !seen.has(key)) {
                          seen.add(key);
                          const ancestor = p.items.find((a) => a.id === key);
                          if (ancestor?.kind === 'page') return i.parent;
                          key = ancestor?.parent;
                        }
                        return null;
                      })(),
                      ...Object.fromEntries(
                        (['domains', 'tags', 'collections'] as Kind[]).map((k) => [
                          k,
                          (i[k] || [])
                            .map((name: string) => p.taxonomy[k].find((t) => t.name === name)?.id)
                            .filter(Boolean),
                        ]),
                      ),
                    })) as Item[],
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '解析中…' : '本地解析并预览'}
            </button>
          </>
        ) : (
          <>
            <div className="knowledge-review-intro">
              <strong>
                待审核 · {selected.length} / {reviews.length} 条
              </strong>
              <p>{preview.notice}</p>
              <small>预览有效 15 分钟；来源性质与日期是用户资料提供的标注，不代表系统确认。</small>
            </div>
            {preview.repeated.length > 0 && (
              <div className="duplicate-notice">
                <strong>检测到同一份资料已导入 {preview.repeated.length} 次</strong>
                <label>
                  <input
                    type="checkbox"
                    aria-label="允许重复导入"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                  />
                  明确另存所选知识（可能重复，不覆盖旧记录）
                </label>
              </div>
            )}
            <div className="knowledge-review-actions">
              <button onClick={() => setSelected(reviews.map((i) => i.id))}>选择全部</button>
              <button onClick={() => setSelected([])}>取消全选</button>
            </div>
            <section className="import-hierarchy">
              <h3>保存后的页面层级</h3>
              <p className="muted">
                仅显式归属构成章节。同目录、引用和关系候选不会自动收纳；未选中的父级需先修改归属。
              </p>
              {hierarchy.map(({ item: r, depth, invalid }) => {
                return (
                  <div key={r.id} style={{ paddingLeft: depth * 20 }}>
                    <span>
                      {r.kind === 'page' ? '▣' : '↳'} {r.title}
                    </span>
                    {r.parent && !selected.includes(r.parent) && (
                      <strong className="danger-text"> 父级未选中</strong>
                    )}
                    {invalid && <small className="danger-text"> · {invalid}，需修改后保存</small>}
                  </div>
                );
              })}
            </section>
            {reviews.map((r) => (
              <article
                className={
                  'knowledge-review-item ' + (selected.includes(r.id) ? '' : 'is-rejected')
                }
                key={r.id}
              >
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={'导入 ' + r.id}
                    checked={selected.includes(r.id)}
                    onChange={() => setSelected(toggle(selected, r.id))}
                  />
                  采用本条 · {r.id}
                </label>
                <fieldset disabled={busy || !selected.includes(r.id)}>
                  <input
                    aria-label={'审核标题 ' + r.id}
                    value={r.title}
                    maxLength={200}
                    onChange={(e) => patch(r.id, { title: e.target.value })}
                  />
                  <textarea
                    aria-label={'审核正文 ' + r.id}
                    rows={5}
                    value={r.body}
                    maxLength={100000}
                    onChange={(e) => patch(r.id, { body: e.target.value })}
                  />
                  <div className="knowledge-fields">
                    <label>
                      页面 / 上级章节
                      <select
                        aria-label={'审核归属 ' + r.id}
                        disabled={r.kind !== 'point'}
                        value={r.parent || ''}
                        onChange={(e) => patch(r.id, { parent: e.target.value || null })}
                      >
                        <option value="">独立保留（不按同目录推定）</option>
                        {reviews
                          .filter((i) => i.id !== r.id && i.kind !== 'capture')
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {knowledgeLabels[i.kind]} · {i.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      正文格式
                      <select
                        aria-label={'审核格式 ' + r.id}
                        value={r.body_format}
                        onChange={(e) =>
                          patch(r.id, { body_format: e.target.value as Item['body_format'] })
                        }
                      >
                        <option value="plain">纯文本</option>
                        <option value="html">安全 HTML</option>
                      </select>
                    </label>
                    <label>
                      对象
                      <select
                        aria-label={'审核类型 ' + r.id}
                        value={r.kind}
                        onChange={(e) =>
                          patch(r.id, {
                            kind: e.target.value as Item['kind'],
                            parent: e.target.value === 'point' ? r.parent : null,
                          })
                        }
                      >
                        {Object.entries(knowledgeLabels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      状态
                      <select
                        aria-label={'审核状态 ' + r.id}
                        value={r.status}
                        onChange={(e) =>
                          patch(r.id, {
                            status: e.target.value as Item['status'],
                            confirm: e.target.value === 'confirmed' ? '确认判断' : '',
                          })
                        }
                      >
                        {Object.entries(stateLabels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      优先级
                      <select
                        aria-label={'审核优先级 ' + r.id}
                        value={r.priority}
                        onChange={(e) => patch(r.id, { priority: Number(e.target.value) })}
                      >
                        {['普通', '关注', '重要', '最高'].map((v, i) => (
                          <option key={i} value={i}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      性质
                      <select
                        aria-label={'审核性质 ' + r.id}
                        value={r.epistemic}
                        onChange={(e) =>
                          patch(r.id, { epistemic: e.target.value as Item['epistemic'] })
                        }
                      >
                        {Object.entries(epistemicLabels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      有证据的原始日期
                      <input
                        aria-label={'审核日期 ' + r.id}
                        type="date"
                        value={r.original_date || ''}
                        onChange={(e) => patch(r.id, { original_date: e.target.value || null })}
                      />
                    </label>
                    <label>
                      已有目录
                      <select
                        aria-label={'审核目录 ' + r.id}
                        value={r.directory_id || ''}
                        onChange={(e) => patch(r.id, { directory_id: e.target.value || null })}
                      >
                        <option value="">已确认的目录建议（未勾选则不归属）</option>
                        <option value="__none__">拒绝目录归属</option>
                        {preview.existingDirectories.map((d) => (
                          <option key={d.id} value={d.id}>
                            {directoryLabel(d, preview.existingDirectories)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    资料提供的记录时间
                    <input
                      aria-label={'审核记录时间 ' + r.id}
                      placeholder="带时区 ISO 时间；未知留空，不使用导入日期"
                      value={r.provided_recorded_at || ''}
                      onChange={(e) =>
                        patch(r.id, { provided_recorded_at: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    日期说明
                    <input
                      aria-label={'审核日期说明 ' + r.id}
                      maxLength={300}
                      value={r.date_note}
                      onChange={(e) => patch(r.id, { date_note: e.target.value })}
                    />
                  </label>
                  <label>
                    待验证问题
                    <textarea
                      aria-label={'审核问题 ' + r.id}
                      value={r.questions}
                      maxLength={10000}
                      onChange={(e) => patch(r.id, { questions: e.target.value })}
                    />
                  </label>
                  <details>
                    <summary>已有分类与来源引用</summary>
                    {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
                      <div key={k}>
                        <small>{labels[k]}</small>
                        <div className="choice-wrap">
                          {preview.taxonomy[k].map((t) => (
                            <button
                              type="button"
                              key={t.id}
                              className={r[k].includes(t.id) ? 'selected' : ''}
                              aria-pressed={r[k].includes(t.id)}
                              onClick={() => patch(r.id, { [k]: toggle(r[k], t.id) })}
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {(preview.items.find((i) => i.id === r.id)?.references || []).map(
                      (ref: any) => (
                        <p key={ref.source_id}>
                          来源 {ref.source_id}：{ref.quote || '未指定逐字摘录；查看来源原文'}
                        </p>
                      ),
                    )}
                  </details>
                  {preview.candidates
                    .find((c) => c.id === r.id)
                    ?.matches.map((m) => (
                      <label className="check-label" key={m.id}>
                        <input
                          type="checkbox"
                          aria-label={'保留重复候选 ' + r.id + ' ' + m.id}
                          checked={existingRelations.includes(r.id + '\n' + m.id)}
                          onChange={() =>
                            setExistingRelations(toggle(existingRelations, r.id + '\n' + m.id))
                          }
                        />
                        {m.title} · {m.reason} · 只记录候选
                      </label>
                    ))}
                </fieldset>
              </article>
            ))}
            {unknown.length > 0 && (
              <section className="knowledge-creation">
                <h3>未知分类创建建议 · 默认不创建</h3>
                {unknown.map((t) => (
                  <label key={t.key} className="check-label">
                    <input
                      type="checkbox"
                      aria-label={'确认创建' + labels[t.kind] + ' ' + t.name}
                      checked={approvedTax.includes(t.key)}
                      onChange={() => setApprovedTax(toggle(approvedTax, t.key))}
                    />
                    {labels[t.kind]}：{t.name}
                  </label>
                ))}
              </section>
            )}
            {!!preview.directories.length && (
              <section className="knowledge-creation">
                <h3>目录树建议 · 默认不创建</h3>
                {preview.directories.map((d) => (
                  <label key={d.id} className="check-label">
                    <input
                      type="checkbox"
                      aria-label={'确认创建目录 ' + d.name}
                      checked={approvedDirs.includes(d.id)}
                      onChange={() => setApprovedDirs(toggle(approvedDirs, d.id))}
                    />
                    {d.name}
                    {d.parent
                      ? ' · 父级 ' + preview.directories.find((p) => p.id === d.parent)?.name
                      : ''}
                  </label>
                ))}
              </section>
            )}
            {(preview.relations.length > 0 || preview.items.some((i) => i.parent)) && (
              <div className="knowledge-creation">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={relations}
                    onChange={(e) => setRelations(e.target.checked)}
                  />
                  保留选中条目间的关系建议（候选，未确认）
                </label>
                {preview.relations.map((r, i) => (
                  <p key={i}>
                    {r.from} → {r.to} · {r.kind} · {r.note}
                  </p>
                ))}
              </div>
            )}
            <details className="knowledge-source-box">
              <summary>来源快照 · {preview.sources.length} 份（未验证）</summary>
              {preview.sources.map((s) => (
                <section key={s.id}>
                  <strong>
                    {s.id} · {sourceLabels[s.kind as keyof typeof sourceLabels]} · {s.title}
                  </strong>
                  <p>
                    原始日期：{s.original_date || '未知'} {s.date_note} · 资料记录时间：
                    {s.recorded_at || '未知'}
                  </p>
                  <pre>{s.excerpt}</pre>
                </section>
              ))}
            </details>
            <div className="form-footer">
              <button
                disabled={busy}
                onClick={async () => {
                  await knowledgeWrite('/import/cancel', 'POST', { token: preview.token });
                  setPreview(null);
                  setApprovedDirs([]);
                  setApprovedTax([]);
                  setRelations(false);
                  setExistingRelations([]);
                  setRepeat(false);
                  setError('');
                }}
              >
                返回原文
              </button>
              <button
                className="primary"
                disabled={busy || !selected.length || (preview.repeated.length > 0 && !repeat)}
                onClick={async () => {
                  if (
                    !confirm(
                      '确认新增 ' +
                        selected.length +
                        ' 条知识？不覆盖旧记录。未知分类/目录仅按勾选创建；人工确认状态需你核对判断。',
                    )
                  )
                    return;
                  setBusy(true);
                  setError('');
                  try {
                    await knowledgeWrite('/import/commit', 'POST', {
                      token: preview.token,
                      confirm: '确认导入所选知识',
                      items: reviews.filter((i) => selected.includes(i.id)),
                      repeat: repeat ? '另存所选知识' : '',
                      approvedTaxonomy: unknown
                        .filter((t) => approvedTax.includes(t.key))
                        .map(({ kind, name }) => ({ kind, name })),
                      approvedDirectories: approvedDirs,
                      includeRelations: relations,
                      organize: true,
                      existingRelations: existingRelations
                        .map((key) => {
                          const [from, to] = key.split('\n');
                          return { from, to };
                        })
                        .filter((r) => selected.includes(r.from)),
                    });
                    onImported();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '事务写入中…' : '确认导入所选知识'}
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
