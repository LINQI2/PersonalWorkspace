import { useState, useEffect } from 'react';
import { api, type Form, type Meta, type Tax } from './shared';
import { parseShareText, type ShareResult } from './shareText';
export function ShareAssist({
  form,
  meta,
  raw,
  setRaw,
  onApply,
  onCreated,
  onBusy,
}: {
  form: Form;
  meta: Meta;
  raw: string;
  setRaw: (s: string) => void;
  onApply: (p: Partial<Form>) => void;
  onCreated: () => void;
  onBusy: (b: boolean) => void;
}) {
  const [result, setResult] = useState<ShareResult>();
  const [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const parse = () => {
    setResult(undefined);
    try {
      const r = parseShareText(raw);
      setResult(r);
      setUrl(r.urls[0] || '');
      setTitle(r.title);
      setTags([]);
      setError(r.urls.length ? '' : '没有识别到有效 HTTP/HTTPS 网址，请手工检查。');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (raw) parse();
    else setResult(undefined);
  }, [raw]);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const apply = async () => {
    if (!result || !url || busy) return;
    if (tags.some((t) => !t.trim() || t.length > 50)) {
      setError('候选标签须为1–50个字符。');
      return;
    }
    const names = [...new Set(tags.map((t) => t.trim()))];
    const fresh = names.filter((name) => !meta.tags.some((t) => t.name === name));
    if (
      fresh.length &&
      !confirm('确认创建分享文字中的候选标签：' + fresh.join('、') + '？这些话题尚未经过内容验证。')
    )
      return;
    setBusy(true);
    try {
      const ids = [...form.tags];
      for (const name of names) {
        const current = await api<Meta>('/meta');
        const tag =
          current.tags.find((t) => t.name === name) ||
          (await api<Tax>('/taxonomy/tags', { method: 'POST', body: JSON.stringify({ name }) }));
        ids.push(tag.id);
      }
      onApply({
        url,
        ...(!form.title.trim() && title.trim() ? { title: title.trim() } : {}),
        tags: [...new Set(ids)],
      });
      if (fresh.length) onCreated();
      setResult(undefined);
      setError('已采用候选；已有标题和笔记保持原样，请核对后保存。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="share-assist" aria-label="分享文字解析">
      <details open={!!raw}>
        <summary>粘贴分享文字 · 本地解析</summary>
        <p className="muted">
          仅识别文字中的网址、标题和话题；不访问网站、不使用
          AI，也不代表已读视频。原文在本次编辑中保留，可复制查看。
        </p>
        <textarea
          aria-label="原始分享文字"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setResult(undefined);
          }}
          placeholder="粘贴抖音、小红书或其他平台的分享文字…"
        />
        <button type="button" disabled={busy || !raw.trim()} onClick={parse}>
          解析分享文字
        </button>
      </details>
      {error && <p role="status">{error}</p>}
      {result && (
        <div className="share-review">
          <strong>分享候选 · 尚未采用</strong>
          {result.urls.length > 1 && <p>包含多个网址，请确认要收藏的一个。</p>}
          <label>
            候选网址
            <select aria-label="分享候选网址" value={url} onChange={(e) => setUrl(e.target.value)}>
              {result.urls.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label>
            候选标题
            <input
              aria-label="分享候选标题"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {form.title.trim() && <small>已有标题不会被覆盖；如需改名，请手工修改原标题。</small>}
          <div className="choice-wrap">
            {result.tags.map((name, index) => (
              <label className="check-label" key={index}>
                <input
                  type="checkbox"
                  aria-label={'分享话题 ' + name}
                  checked={tags.includes(name)}
                  onChange={(e) =>
                    setTags((p) => (e.target.checked ? [...p, name] : p.filter((t) => t !== name)))
                  }
                />
                <input
                  aria-label={'分享候选话题 ' + (index + 1)}
                  value={name}
                  maxLength={50}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTags((p) => p.map((t) => (t === name ? next : t)));
                    setResult((p) =>
                      p ? { ...p, tags: p.tags.map((t, i) => (i === index ? next : t)) } : p,
                    );
                  }}
                />
              </label>
            ))}
          </div>
          <div className="ai-review-actions">
            <button type="button" disabled={busy} onClick={() => setResult(undefined)}>
              拒绝分享候选
            </button>
            <button type="button" className="primary" disabled={!url || busy} onClick={apply}>
              采用分享候选
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
