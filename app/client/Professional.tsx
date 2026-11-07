import { RichEditor } from './RichEditor';
import { ContentActions } from './ContentActions';
import { RelatedPanel } from './RelatedPanel';
import { useEffect, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
import './professional.css';
import { ProfessionalImport } from './ProfessionalImport';
const labels: Record<string, string> = {
  concept: '概念 / 原理',
  principle: '原则',
  method: '方法 / 算法',
  architecture: '架构 / 模式',
  tool: '工具 / 框架',
  case: '实践案例',
};
const write = async (path: string, body: any, method = 'POST') => {
  const session = await api('/local/session');
  return api('/professional/' + path, {
    method,
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify(body),
  });
};
export function Professional({
  active,
  onOpen,
  target,
}: {
  active: boolean;
  onOpen: (id: string) => void;
  target?: { id: string; nonce: number } | null;
}) {
  const [domains, setDomains] = useState<any[]>([]),
    [trash, setTrash] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [versions, setVersions] = useState<any[] | null>(null),
    [version, setVersion] = useState<any>(null),
    [rows, setRows] = useState<any[]>([]),
    [domain, setDomain] = useState(''),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [card, setCard] = useState<any>(null),
    [form, setForm] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (target)
      api('/professional/read/' + target.id)
        .then((e) => {
          if (live) {
            setCard(e);
            setTrash(e.lifecycle?.state === 'trash');
          }
        })
        .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [target]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (form) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [form]);
  const load = async () => {
    setDomains(await api('/professional/domains'));
    setRows(
      await api(
        '/professional/search?' +
          new URLSearchParams({ q: query, domain, kind, view: trash ? 'trash' : 'active' }),
      ),
    );
  };
  useEffect(() => {
    let live = true;
    if (active)
      Promise.all([
        api('/professional/domains'),
        api(
          '/professional/search?' +
            new URLSearchParams({ q: query, domain, kind, view: trash ? 'trash' : 'active' }),
        ),
      ])
        .then(([d, r]) => {
          if (live) {
            setDomains(d);
            setRows(r);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [active, query, domain, kind, trash]);
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
  const selected = domains.find((d) => d.id === domain);
  const tree = (parent: string | null, depth = 0): any =>
    domains
      .filter((d) => d.parent_id === parent)
      .map((d) => (
        <div key={d.id}>
          <div style={{ paddingLeft: depth * 12 }} className="professional-tree-row">
            <button
              aria-label={'展开或折叠' + d.name}
              onClick={() =>
                setCollapsed((v) => (v.includes(d.id) ? v.filter((x) => x !== d.id) : [...v, d.id]))
              }
            >
              {collapsed.includes(d.id) ? '＋' : '−'}
            </button>
            <button
              className={domain === d.id ? 'active' : ''}
              onClick={() => {
                setDomain(d.id);
                setCard(null);
              }}
            >
              {d.name} ({d.count})
            </button>
          </div>
          {!collapsed.includes(d.id) && tree(d.id, depth + 1)}
        </div>
      ));
  const edit = (entry?: any) =>
    setForm(
      entry
        ? {
            ...entry,
            aliases: entry.aliases.join(' / '),
            professional_domains: entry.professional_domains.map((d: any) => d.id),
            primary_domain: entry.professional_domains.find((d: any) => d.is_primary)?.id,
          }
        : {
            title: '',
            description: '',
            content: '',
            concept_kind: 'concept',
            aliases: '',
            scope_note: '',
            professional_domains: domain ? [domain] : [],
            primary_domain: domain,
          },
    );
  return (
    <section className="professional-module" aria-label="专业知识">
      <header>
        <div>
          <div className="eyebrow">PROFESSIONAL KNOWLEDGE</div>
          <h1>专业知识</h1>
          <p>系统化概念、方法与有证据的实践。来源性质与核验状态分别判断。</p>
        </div>
        <button
          onClick={() =>
            run(async () => {
              const p = await api('/professional/seed/preview');
              if (
                !confirm(
                  '预览：新增 ' +
                    p.domains.length +
                    ' 个目录、' +
                    p.cards.length +
                    ' 张样例。来源清单：\n' +
                    p.cards.map((c: any) => c.title + ' ' + c.source).join('\n') +
                    '\n确认创建？已有内容保留。',
                )
              )
                return;
              await write('seed', { confirm: '创建已审核专业样例' });
              await load();
            })
          }
        >
          初始化差异预览
        </button>
        <button onClick={() => edit()}>建立专业条目</button>
        <button onClick={() => setImportOpen(true)}>导入专业知识</button>
        <button
          onClick={() =>
            run(async () => {
              const p = await api('/professional/seed/preview?batch=full');
              if (
                !confirm(
                  '扩展预览：' +
                    p.cards.length +
                    '张新卡；其中有明确待核验条目。\n' +
                    p.cards.map((c: any) => c.title + ' ' + c.source).join('\n') +
                    '\n确认以待审核状态新增？',
                )
              )
                return;
              await write('seed', { batch: 'full', confirm: '创建已审核专业样例' });
              await load();
            })
          }
        >
          扩展至40张（审核预览）
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="professional-layout">
        <aside>
          <button
            className={trash ? 'active' : ''}
            onClick={() => {
              setTrash((v) => !v);
              setCard(null);
            }}
          >
            {trash ? '返回专业知识' : '专业回收站'}
          </button>
          <button
            onClick={() => {
              setDomain('');
              setCard(null);
            }}
          >
            全部专业领域
          </button>
          {tree(null)}
          <button
            onClick={() =>
              run(async () => {
                const name = prompt('新领域名称');
                if (!name) return;
                await write('domains', { name, parent_id: domain || null });
                await load();
              })
            }
          >
            新增领域
          </button>
          {selected && (
            <>
              <button
                onClick={() =>
                  run(async () => {
                    const name = prompt('领域名称', selected.name);
                    if (!name) return;
                    const summary = prompt('领域说明', selected.summary);
                    if (summary === null) return;
                    const position = Number(
                      prompt('同级排序（从0开始）', String(selected.position)),
                    );
                    await write(
                      'domains/' + domain,
                      { ...selected, name, summary, position },
                      'PUT',
                    );
                    await load();
                  })
                }
              >
                编辑领域 / 排序
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    if (!confirm('删除专业领域？有子领域或内容时拒绝。')) return;
                    await write('domains/' + domain, { confirm: '删除专业领域' }, 'DELETE');
                    setDomain('');
                    await load();
                  })
                }
              >
                删除领域
              </button>
            </>
          )}
        </aside>
        <main>
          <div className="professional-filters">
            <input
              aria-label="搜索专业知识"
              placeholder="名称、英文别名、正文"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select aria-label="专业类别" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">全部类别</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <h2>{selected?.name || '专业知识目录'}</h2>
          <p>{selected?.summary}</p>
          <p>{selected?.scope_note}</p>
          {card ? (
            <article>
              <button onClick={() => setCard(null)}>返回列表</button>
              <h2>{card.title}</h2>
              <p>
                {card.aliases.join(' · ')} · {labels[card.concept_kind]}
              </p>
              <p>主要领域：{card.professional_domains.find((d: any) => d.is_primary)?.name}</p>
              <h3>核心定义</h3>
              <p>{card.description}</p>
              <h3>适用与边界</h3>
              <p>{card.scope_note}</p>
              <div dangerouslySetInnerHTML={{ __html: card.content }} />
              <h3>来源与审核</h3>
              {card.lifecycle?.state === 'trash' && (
                <p role="status">位于专业回收站，正文、来源与版本保留；恢复后可编辑。</p>
              )}
              <p>内容状态：{card.status}；来源链接不等于已核验。</p>
              {card.sources.map((s: any) => (
                <p key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>{' '}
                  · {s.date_note}
                </p>
              ))}
              <ContentActions
                entry={card}
                onChanged={() =>
                  run(async () => {
                    setCard(await api('/professional/read/' + card.id));
                    await load();
                  })
                }
                onEdit={card.lifecycle?.state === 'trash' ? undefined : () => edit(card)}
              />
              {card.lifecycle?.state !== 'trash' && (
                <RelatedPanel
                  id={card.id}
                  onOpen={onOpen}
                  onChanged={() =>
                    run(async () => {
                      setCard(await api('/professional/read/' + card.id));
                    })
                  }
                />
              )}
              <h3>相关知识</h3>
              {card.relations.map((r: any) => (
                <p key={r.id}>
                  {r.other?.title} · {r.direction} · {r.type} · {r.state}
                </p>
              ))}
              <button disabled={card.lifecycle?.state === 'trash'} onClick={() => edit(card)}>
                人工编辑
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    setVersions(await api('/professional/versions/' + card.id));
                    setVersion(null);
                  })
                }
              >
                版本历史
              </button>
            </article>
          ) : (
            <>
              <div className="professional-cards">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() =>
                      run(async () => setCard(await api('/professional/read/' + r.id)))
                    }
                  >
                    <h3>{r.title}</h3>
                    <p>{r.aliases.join(' · ')}</p>
                    <small>{labels[r.concept_kind]}</small>
                    <p>{r.description}</p>
                  </button>
                ))}
              </div>
              {!rows.length && <p>尚未配置内容</p>}
            </>
          )}
        </main>
      </div>
      {importOpen && (
        <ProfessionalImport
          onClose={() => setImportOpen(false)}
          onSaved={() => {
            void load();
          }}
        />
      )}
      {versions && (
        <Dialog
          title="专业知识版本历史"
          onClose={() => {
            setVersions(null);
            setVersion(null);
          }}
        >
          <p>历史正文可放入编辑器审核，不会立即覆盖正式记录；别名、领域和当前来源保留。</p>
          {!versions.length && <p>尚无历史版本</p>}
          {versions.map((v) => (
            <button key={v.id} onClick={() => setVersion(v)}>
              修订 {v.revision} · {v.created_at} · {v.title}
            </button>
          ))}
          {version && (
            <>
              <h3>{version.title}</h3>
              <div dangerouslySetInnerHTML={{ __html: version.content }} />
              <button
                disabled={card?.lifecycle?.state === 'trash'}
                onClick={() => {
                  edit({ ...card, title: version.title, content: version.content });
                  setVersions(null);
                  setVersion(null);
                }}
              >
                放入编辑器审核
              </button>
            </>
          )}
        </Dialog>
      )}
      {form && (
        <Dialog
          title="专业知识编辑"
          onClose={() => {
            if (confirm('关闭编辑？尚未保存的修改将丢弃。')) setForm(null);
          }}
        >
          <label>
            规范名称
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            别名（用 / 分隔）
            <input
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            />
          </label>
          <label>
            类别
            <select
              value={form.concept_kind}
              onChange={(e) => setForm({ ...form, concept_kind: e.target.value })}
            >
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            主要领域
            <select
              value={form.primary_domain}
              onChange={(e) =>
                setForm({
                  ...form,
                  primary_domain: e.target.value,
                  professional_domains: [
                    ...new Set([...form.professional_domains, e.target.value]),
                  ].filter(Boolean),
                })
              }
            >
              <option value="">请选择领域</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>关联专业领域（可多选，主要领域必须保留）</legend>
            {domains.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={form.professional_domains.includes(d.id)}
                  disabled={form.primary_domain === d.id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      professional_domains: e.target.checked
                        ? [...form.professional_domains, d.id]
                        : form.professional_domains.filter((id: string) => id !== d.id),
                    })
                  }
                />
                {d.name}
              </label>
            ))}
          </fieldset>
          <label>
            核心定义
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label>
            适用与边界
            <textarea
              value={form.scope_note}
              onChange={(e) => setForm({ ...form, scope_note: e.target.value })}
            />
          </label>
          <label>
            人工审核状态
            <select
              value={form.status || 'draft'}
              onChange={(e) => setForm({ ...form, status: e.target.value, confirm: undefined })}
            >
              <option value="draft">草稿</option>
              <option value="review">待审核</option>
              <option value="confirmed">人工确认判断</option>
            </select>
          </label>
          {form.status === 'confirmed' && (
            <label>
              <input
                type="checkbox"
                checked={form.confirm === '确认判断'}
                onChange={(e) =>
                  setForm({ ...form, confirm: e.target.checked ? '确认判断' : undefined })
                }
              />
              我已审核内容并确认判断（不代表来源具有权威性）
            </label>
          )}
          <fieldset>
            <legend>追加来源（保留已有来源）</legend>
            <label>
              来源标题
              <input
                value={form.newSource?.title || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    newSource: {
                      kind: 'website',
                      excerpt: '',
                      ...form.newSource,
                      title: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              来源URL
              <input
                value={form.newSource?.url || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    newSource: {
                      kind: 'website',
                      excerpt: '',
                      ...form.newSource,
                      url: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              来源依据摘要
              <textarea
                value={form.newSource?.excerpt || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    newSource: { kind: 'website', ...form.newSource, excerpt: e.target.value },
                  })
                }
              />
            </label>
            <label>
              适用版本 / 核验说明
              <input
                value={form.newSource?.date_note || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    newSource: {
                      kind: 'website',
                      excerpt: '',
                      ...form.newSource,
                      date_note: e.target.value,
                    },
                  })
                }
              />
            </label>
          </fieldset>
          <label>
            正文
            <RichEditor
              content={form.content}
              onChange={(content) => setForm({ ...form, content })}
              onError={setError}
              onBusy={setBusy}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const saved = await write(
                  'entries' + (form.id ? '/' + form.id : ''),
                  {
                    ...form,
                    aliases: form.aliases
                      .split('/')
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                  },
                  form.id ? 'PUT' : 'POST',
                );
                setCard(saved);
                setForm(null);
                await load();
              })
            }
          >
            审核并保存
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const session = await api('/local/session');
                await api(
                  '/knowledge/drafts/' + encodeURIComponent('professional:' + (form.id || 'new')),
                  {
                    method: 'PUT',
                    headers: { 'X-PK-Session': session.token },
                    body: JSON.stringify(form),
                  },
                );
              })
            }
          >
            保存独立草稿
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const draft = await api(
                  '/knowledge/drafts/' + encodeURIComponent('professional:' + (form.id || 'new')),
                );
                if (draft && confirm('恢复保存的专业草稿？正式记录仍保留。')) setForm(draft.form);
              })
            }
          >
            恢复独立草稿
          </button>
        </Dialog>
      )}
    </section>
  );
}
