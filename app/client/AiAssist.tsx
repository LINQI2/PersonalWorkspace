import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Check } from 'lucide-react';
import { api, labels, type Form, type Meta, type Kind, type Tax } from './shared';

type Suggestion = {
  status: 'ready' | 'insufficient';
  title: string;
  summary: string;
  reason: string;
  domains: string[];
  tags: string[];
  collections: string[];
  newTags: string[];
  points: string[];
  sections: { heading: string; paragraphs: string[]; points: string[] }[];
};
type AiStatus = {
  configured: boolean;
  message: string;
  model: string;
  limits: {
    maxCallsPerHour: number;
    maxInputChars: number;
    maxOutputTokens: number;
    timeoutMs: number;
  } | null;
  usage: { recordedRequests: number; estimatedUSD: number; unknownUsage: number };
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const prose = (value: string) =>
  value
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) =>
      line.startsWith('## ')
        ? '<h3>' + escape(line.slice(3)) + '</h3>'
        : '<p>' + escape(line) + '</p>',
    )
    .join('');

export function AiAssist({
  form,
  meta,
  disabled,
  onApply,
  onCreated,
  onBusy,
  registerNoteAction,
}: {
  form: Form;
  meta: Meta;
  disabled: boolean;
  onApply: (patch: Partial<Form>) => void;
  onCreated: () => void;
  onBusy: (busy: boolean) => void;
  registerNoteAction: (action: (() => void) | undefined) => void;
}) {
  const [status, setStatus] = useState<AiStatus>();
  const [result, setResult] = useState<Suggestion>();
  const [mode, setMode] = useState<'bookmark' | 'note'>('bookmark');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState({ title: true, summary: true, body: false });
  const [chosen, setChosen] = useState<Record<Kind, string[]>>({
    domains: [],
    tags: [],
    collections: [],
  });
  const [newTags, setNewTags] = useState<string[]>([]);
  const [usage, setUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    estimatedUSD: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const snapshot = useRef('');
  const reviewRef = useRef<HTMLFieldSetElement | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const refreshStatus = () =>
    api<AiStatus>('/ai/status')
      .then(setStatus)
      .catch(() => setError('AI 状态暂不可用，手动编辑不受影响。'));
  useEffect(() => {
    let current = true;
    api<AiStatus>('/ai/status')
      .then((s) => {
        if (current) setStatus(s);
      })
      .catch(() => {
        if (current) setError('AI 状态暂不可用，手动编辑不受影响。');
      });
    return () => {
      current = false;
      sequence.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    if (result?.status === 'ready' && snapshot.current === JSON.stringify(formRef.current)) {
      reviewRef.current?.focus({ preventScroll: true });
      reviewRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [result?.status]);
  const cancel = () => {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setResult(undefined);
    setFeedback('AI 请求已取消，原始内容保持不变。');
  };
  const generate = async (nextMode: 'bookmark' | 'note') => {
    if (busy || disabled) return;
    const id = ++sequence.current;
    const c = new AbortController();
    controller.current = c;
    snapshot.current = JSON.stringify(formRef.current);
    setBusy(true);
    setError('');
    setFeedback('');
    setResult(undefined);
    setMode(nextMode);
    try {
      const data = await api<{
        suggestion: Suggestion;
        usage: typeof usage;
        usageWarning?: string;
      }>('/ai/suggest', {
        method: 'POST',
        signal: c.signal,
        body: JSON.stringify({ mode: nextMode, form: formRef.current }),
      });
      if (id !== sequence.current) return;
      setResult(data.suggestion);
      setTitle(data.suggestion.title);
      setSummary(data.suggestion.summary);
      setBody(
        [
          ...data.suggestion.sections.flatMap((s) => [
            '## ' + s.heading,
            ...s.paragraphs,
            ...s.points.map((p) => '• ' + p),
          ]),
          ...(data.suggestion.points.length
            ? ['## 提炼要点', ...data.suggestion.points.map((p) => '• ' + p)]
            : []),
        ].join('\n\n'),
      );
      setSelected({
        title: !!data.suggestion.title,
        summary: !!data.suggestion.summary,
        body: nextMode === 'note',
      });
      setChosen({
        domains: data.suggestion.domains,
        tags: data.suggestion.tags,
        collections: data.suggestion.collections,
      });
      setNewTags([]);
      setUsage(data.usage);
      setFeedback(data.usageWarning || '候选已生成，尚未修改编辑表单或正式记录。');
      refreshStatus();
    } catch (e) {
      if (id === sequence.current && !c.signal.aborted) setError((e as Error).message);
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  };
  // The editor toolbar uses the same request/review state, rather than a separate AI workflow.
  useEffect(() => {
    registerNoteAction(() => generate('note'));
    return () => registerNoteAction(undefined);
  }, [busy, disabled, form]);
  const stale = !!result && snapshot.current !== JSON.stringify(form);
  const apply = async (all = false) => {
    if (!result || stale || busy) return;
    const picks = all ? { title: !!title, summary: !!summary, body: mode === 'note' } : selected;
    const tax = all
      ? { domains: result.domains, tags: result.tags, collections: result.collections }
      : chosen;
    const freshTags = [...new Set((all ? result.newTags : newTags).map((name) => name.trim()))];
    if (freshTags.some((name) => !name || name.length > 50)) {
      setError('候选新标签须为 1–50 个字符。');
      return;
    }
    if (
      freshTags.length &&
      !confirm(
        '确认创建并添加这些新标签：' + freshTags.join('、') + '？只有保存条目后才绑定到正式记录。',
      )
    )
      return;
    if (picks.title && !title.trim()) {
      setError('推荐标题不能为空。');
      return;
    }
    if (picks.body && !body.trim()) {
      setError('整理稿不能为空。');
      return;
    }
    setBusy(true);
    setApplying(true);
    setError('');
    try {
      const patch: Partial<Form> = {};
      for (const k of ['domains', 'tags', 'collections'] as Kind[]) {
        if (tax[k].some((id) => !meta[k].some((t) => t.id === id)))
          throw Error('分类已变化，请重新生成建议。');
        if (tax[k].length) patch[k] = [...new Set([...form[k], ...tax[k]])];
      }
      if (freshTags.length) {
        const current = await api<Meta>('/meta');
        const ids: string[] = [];
        for (const name of freshTags) {
          const tag: Tax =
            current.tags.find((t) => t.name === name) ||
            (await api<Tax>('/taxonomy/tags', { method: 'POST', body: JSON.stringify({ name }) }));
          ids.push(tag.id);
          if (!current.tags.some((t) => t.id === tag.id)) current.tags.push(tag);
        }
        patch.tags = [...new Set([...form.tags, ...(patch.tags || []), ...ids])];
        onCreated();
      }
      if (picks.title) patch.title = title.trim();
      if (picks.summary) patch.description = summary;
      // Append-only adoption: original HTML, links, image references, facts and formatting remain intact.
      if (picks.body) patch.content = form.content + '<h2>AI 整理稿（原文保留）</h2>' + prose(body);
      if (Object.keys(patch).length === 0) {
        setError('请选择至少一项建议。');
        return;
      }
      if (JSON.stringify(formRef.current) !== snapshot.current)
        throw Error('编辑内容已变化，请重新生成；已确认创建的标签仍保留。');
      onApply(patch);
      setResult(undefined);
      setFeedback('已采用到编辑表单，请核对后点击「保存条目」。原文已保留。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setApplying(false);
    }
  };
  const reject = () => {
    setResult(undefined);
    setFeedback('已拒绝建议，编辑内容保持不变。');
    setError('');
  };
  return (
    <section className="ai-assist" aria-label="AI 辅助整理">
      <div className="ai-heading">
        <span>
          <Sparkles size={17} /> AI 辅助整理 <small>可选 · 人工审核</small>
        </span>
        <button type="button" disabled={busy || disabled} onClick={() => generate('bookmark')}>
          <Sparkles size={15} />
          AI 帮我整理
        </button>
      </div>
      <p className="muted ai-disclosure">
        仅主动发送本次标题、简介、正文文字及最多 40 个/种分类名称和
        ID。收藏网址字段与图片不发送；不会抓取网页。正文中的文字链接仍属于本次文字。建议不自动保存。
      </p>
      {!status?.configured && (
        <p className="muted">
          {status?.message || '正在检查 AI 配置…'}{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setFeedback(
                '在服务端配置所选 Provider 的环境变量密钥后重启。配置方法见 README 和 docs/AI.md；请勿在网页输入密钥。',
              );
            }}
          >
            配置说明
          </a>
        </p>
      )}
      {!!status?.configured && (
        <p className="ai-usage">
          {status.model} · 每小时上限 {status.limits?.maxCallsPerHour} 次 · 近期记录{' '}
          {status.usage.recordedRequests} 次 / 估算 ${status.usage.estimatedUSD.toFixed(4)}
          {status.usage.unknownUsage > 0 ? '（部分调用用量未知）' : ''}
        </p>
      )}
      {busy && (
        <div role="status" className="ai-loading">
          {applying ? '正在采用已确认的建议…' : '正在生成建议…'}
          <button type="button" disabled={applying} onClick={cancel}>
            取消 AI 请求
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {feedback && (
        <p role="status" className="ai-feedback">
          {feedback}
        </p>
      )}
      {result?.status === 'insufficient' && (
        <div className="ai-review">
          <strong>信息不足</strong>
          <p>{result.reason}</p>
          <button type="button" onClick={reject}>
            关闭建议
          </button>
        </div>
      )}
      {result?.status === 'ready' && (
        <fieldset
          className="ai-review"
          aria-label="AI 建议审核"
          ref={reviewRef}
          tabIndex={-1}
          disabled={applying}
        >
          <div className="ai-review-head">
            <strong>AI 候选 · 尚未保存</strong>
            <button
              type="button"
              className="icon"
              aria-label="拒绝 AI 建议"
              disabled={busy}
              onClick={reject}
            >
              <X size={17} />
            </button>
          </div>
          <p>{result.reason}</p>
          {stale && <div className="error">编辑内容已变化，请重新生成建议，避免覆盖新输入。</div>}
          <label className="check-label">
            <input
              type="checkbox"
              checked={selected.title}
              onChange={(e) => setSelected((s) => ({ ...s, title: e.target.checked }))}
            />
            采用标题
          </label>
          <input
            aria-label="AI 推荐标题"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={selected.summary}
              onChange={(e) => setSelected((s) => ({ ...s, summary: e.target.checked }))}
            />
            采用摘要
          </label>
          <textarea
            aria-label="AI 摘要"
            value={summary}
            maxLength={1000}
            onChange={(e) => setSummary(e.target.value)}
          />
          {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
            <div className="ai-choices" key={k}>
              <strong>{labels[k]}建议 · 仅追加</strong>
              <div>
                {result[k].map((id) => (
                  <label className="check-label" key={id}>
                    <input
                      type="checkbox"
                      aria-label={
                        'AI ' +
                        labels[k] +
                        ' ' +
                        (meta[k].find((t) => t.id === id)?.name || '已删除分类')
                      }
                      checked={chosen[k].includes(id)}
                      onChange={(e) =>
                        setChosen((s) => ({
                          ...s,
                          [k]: e.target.checked ? [...s[k], id] : s[k].filter((x) => x !== id),
                        }))
                      }
                    />
                    {meta[k].find((t) => t.id === id)?.name || '已删除分类'}
                  </label>
                ))}
                {!result[k].length && <small>没有足够依据推荐</small>}
              </div>
            </div>
          ))}
          {!!result.newTags.length && (
            <div className="ai-choices">
              <strong>候选新标签 · 创建需确认</strong>
              {result.newTags.map((name, index) => (
                <label key={index} className="check-label">
                  <input
                    type="checkbox"
                    aria-label={'AI 新标签 ' + name}
                    checked={newTags.includes(name)}
                    onChange={(e) =>
                      setNewTags((p) =>
                        e.target.checked ? [...p, name] : p.filter((n) => n !== name),
                      )
                    }
                  />
                  <input
                    aria-label={'AI 候选新标签 ' + (index + 1)}
                    value={name}
                    maxLength={50}
                    onChange={(e) => {
                      const next = e.target.value;
                      setNewTags((p) => p.map((n) => (n === name ? next : n)));
                      setResult((p) =>
                        p
                          ? { ...p, newTags: p.newTags.map((n, i) => (i === index ? next : n)) }
                          : p,
                      );
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          {mode === 'note' && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={selected.body}
                  onChange={(e) => setSelected((s) => ({ ...s, body: e.target.checked }))}
                />
                追加整理稿并保留原文
              </label>
              <p className="muted">
                核对事实、数字和判断。采用后原文完整保留在前，整理稿追加在后；可继续在笔记编辑器修改。
              </p>
              <textarea
                className="ai-note-preview"
                aria-label="AI 整理稿预览"
                value={body}
                maxLength={16000}
                onChange={(e) => setBody(e.target.value)}
              />
            </>
          )}
          {mode === 'bookmark' && !!result.points.length && (
            <ul>
              {result.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {!!usage && (
            <p className="ai-usage">
              本次输入 {usage.inputTokens} / 输出 {usage.outputTokens} Token · 估算 $
              {usage.estimatedUSD.toFixed(5)}（非账单）
            </p>
          )}
          <div className="ai-review-actions">
            <button type="button" disabled={busy} onClick={reject}>
              取消 / 拒绝
            </button>
            <button type="button" disabled={busy || stale} onClick={() => apply(false)}>
              采用所选建议
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || stale}
              onClick={() => apply(true)}
            >
              <Check size={15} />
              接受全部建议
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
