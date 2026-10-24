import { useState, useEffect } from 'react';
import { Dialog } from './components';
import { knowledgeWrite } from './knowledgeTypes';
import { type Meta } from './shared';
export function PasteImport({
  meta,
  onClose,
  onChanged,
  onOpen,
}: {
  meta: Meta;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const [raw, setRaw] = useState(''),
    [format, setFormat] = useState('markdown'),
    [type, setType] = useState('document'),
    [sourceKind, setSourceKind] = useState('chatgpt'),
    [sourceName, setSourceName] = useState('ChatGPT 手动粘贴（未核验原始对话）'),
    [title, setTitle] = useState(''),
    [domain, setDomain] = useState(''),
    [tag, setTag] = useState(''),
    [topic, setTopic] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [items, setItems] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [duplicate, setDuplicate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
  const close = () => {
    if (busy) return;
    if (raw.trim() && !confirm('关闭尚未完成的粘贴导入？正式资料未更改。')) return;
    if (preview) void knowledgeWrite('/paste/cancel', 'POST', { token: preview.token });
    onClose();
  };
  const reset = () => {
    if (preview) void knowledgeWrite('/paste/cancel', 'POST', { token: preview.token });
    setPreview(null);
    setDuplicate(false);
  };
  const candidates = preview?.candidates.filter((c: any) => c.matches.length) || [];
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (raw.trim()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [raw]);
  const depth = (item: any) => {
    let n = 0,
      p = item.parent;
    while (p && n < 8) {
      n++;
      p = items.find((i) => i.id === p)?.parent;
    }
    return n;
  };
  return (
    <Dialog title="粘贴收纳 · 纯文本 / Markdown" wide onClose={close}>
      <div className="paste-import">
        <p className="muted">
          仅在本机解析，不访问ChatGPT历史或网站，不调用AI。日期和作者未知时保持未知；原始粘贴全文保存在来源快照。
        </p>
        {!preview ? (
          <>
            <textarea
              aria-label="粘贴原始内容"
              rows={12}
              maxLength={100000}
              placeholder="# 研究标题&#10;## 核心观点&#10;粘贴文字或Markdown，先预览再确认"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <div className="paste-options">
              <label>
                解析格式
                <select
                  aria-label="粘贴解析格式"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="markdown">Markdown（明确标题与列表）</option>
                  <option value="text">普通纯文本（不拆章节）</option>
                </select>
              </label>
              <label>
                保存为
                <select
                  aria-label="粘贴内容类型"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="document">综合文档</option>
                  <option value="note">普通笔记</option>
                </select>
              </label>
              <label>
                来源性质
                <select
                  aria-label="粘贴来源类型"
                  value={sourceKind}
                  onChange={(e) => {
                    setSourceKind(e.target.value);
                    setSourceName('');
                  }}
                >
                  <option value="chatgpt">ChatGPT（用户说明，未核验）</option>
                  <option value="inspiration">个人灵感</option>
                  <option value="report">周报/资料</option>
                  <option value="website">网站</option>
                  <option value="other">其他/未知</option>
                </select>
              </label>
            </div>
            <input
              aria-label="粘贴标题"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="可选标题，默认首个非空行"
            />
            <input
              aria-label="来源说明"
              value={sourceName}
              maxLength={200}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="来源说明（可选，勿虚构日期作者）"
            />
            <button
              className="primary"
              disabled={busy || !raw.trim()}
              onClick={() =>
                void run(async () => {
                  const p = await knowledgeWrite('/paste/preview', 'POST', {
                    raw,
                    format,
                    type,
                    title,
                    sourceKind,
                    sourceName,
                  });
                  setPreview(p);
                  setItems(p.items);
                  setSelected(p.items.map((i: any) => i.id));
                  setDuplicate(false);
                })
              }
            >
              {busy ? '解析中…' : '本地解析并预览'}
            </button>
          </>
        ) : (
          <>
            <div className="paste-options">
              {(['domains', 'tags', 'collections'] as const).map((kind, i) => (
                <label key={kind}>
                  {['领域', '标签', '专题'][i]}
                  <select
                    aria-label={'粘贴归属' + kind}
                    value={[domain, tag, topic][i]}
                    onChange={(e) => [setDomain, setTag, setTopic][i](e.target.value)}
                  >
                    <option value="">暂不设置</option>
                    {meta[kind].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <h3>实际保存结构 · {items.length} 项</h3>
            <p className="muted">
              取消章节前请一并取消其下级；不按相同领域推定从属。可以返回修改格式/类型再解析。
            </p>
            <div className="paste-tree">
              {items.map((i) => (
                <article key={i.id} style={{ marginLeft: Math.min(depth(i) * 16, 96) }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(i.id)}
                      onChange={(e) =>
                        setSelected((xs) =>
                          e.target.checked ? [...xs, i.id] : xs.filter((x) => x !== i.id),
                        )
                      }
                    />
                    {i.content_type === 'block'
                      ? '章节 → ' + (items.find((p) => p.id === i.parent)?.title || '根文档')
                      : i.content_type === 'document'
                        ? '综合文档'
                        : '普通笔记'}
                  </label>
                  <input
                    aria-label={'预览标题 ' + i.id}
                    value={i.title}
                    maxLength={200}
                    onChange={(e) =>
                      setItems((xs) =>
                        xs.map((x) => (x.id === i.id ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                  <details>
                    <summary>查看解析正文</summary>
                    <div className="prose" dangerouslySetInnerHTML={{ __html: i.content }} />
                  </details>
                </article>
              ))}
            </div>
            {!!(candidates.length || preview.repeated.length) && (
              <section className="duplicate-warning" aria-label="疑似重复资料">
                <h3>疑似重复，请先核对</h3>
                {preview.repeated.length > 0 && (
                  <p>此粘贴包曾导入；另存会创建新的稳定ID，不覆盖。</p>
                )}
                {candidates.map((c: any) => (
                  <div key={c.id}>
                    {c.matches.map((m: any) => (
                      <p key={m.id}>
                        <a href={'#content-' + m.id} target="_blank" rel="noopener noreferrer">
                          新标签页打开已有：{m.title}
                        </a>{' '}
                        · {m.reason}
                      </p>
                    ))}
                  </div>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={duplicate}
                    onChange={(e) => setDuplicate(e.target.checked)}
                  />
                  我已核对，仍要另存所选内容
                </label>
              </section>
            )}
            <p>
              ChatGPT资料保持“AI推断 · 待验证”；个人资料也不会自动标记为人工确认。原始日期未知。
            </p>
            <div className="paste-actions">
              <button disabled={busy} onClick={reset}>
                返回修改
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !selected.length ||
                  ((candidates.length > 0 || preview.repeated.length > 0) && !duplicate)
                }
                onClick={() =>
                  void run(async () => {
                    const checked = await knowledgeWrite('/paste/check', 'POST', {
                      token: preview.token,
                      items: items
                        .filter((i) => selected.includes(i.id))
                        .map((i) => ({ id: i.id, title: i.title })),
                    });
                    setPreview((p: any) => ({ ...p, candidates: checked.candidates }));
                    if (checked.candidates.some((c: any) => c.matches.length) && !duplicate)
                      throw Error('保存前发现疑似重复，请查看候选并明确确认另存。');
                    const r = await knowledgeWrite('/paste/commit', 'POST', {
                      token: preview.token,
                      confirm: '确认导入所选知识',
                      confirmDuplicate: duplicate,
                      repeat: duplicate ? '另存所选知识' : '',
                      approvedDomains: [],
                      approvedTaxonomy: [],
                      keepRelations: false,
                      items: items
                        .filter((i) => selected.includes(i.id))
                        .map((i) => ({
                          id: i.id,
                          title: i.title,
                          body: i.body,
                          body_format: i.body_format,
                          content_type: i.content_type,
                          ...(i.parent ? { parent: i.parent } : {}),
                          domains: domain ? [domain] : [],
                          tags: tag ? [tag] : [],
                          collections: topic ? [topic] : [],
                          primary_domain_id: domain || null,
                        })),
                    });
                    onChanged();
                    onClose();
                    onOpen(r.ids.root || Object.values(r.ids)[0]);
                  })
                }
              >
                {busy ? '保存中…' : '确认收纳所选内容'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
