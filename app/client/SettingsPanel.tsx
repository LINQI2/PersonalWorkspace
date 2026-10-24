import { useEffect, useState, useRef } from 'react';
import { Pencil, Trash2, Download, Upload } from 'lucide-react';
import { api, labels, type Kind, type Meta } from './shared';
import { Dialog } from './components';
import { CleanupInventory } from './CleanupInventory';
import { AiSettings, LocalServiceControl } from './AiSettings';
import { DomainTree, domainOutline } from './DomainTree';
import { discardQuickDraft } from './quickDraft';
export function BatchDialog({
  meta,
  count,
  busy,
  onClose,
  onApply,
}: {
  meta: Meta;
  count: number;
  busy: boolean;
  onClose: () => void;
  onApply: (data: object) => void;
}) {
  const [kind, setKind] = useState<Kind>('domains');
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <Dialog
      title="批量添加分类"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="settings-panel">
        <p className="muted">为所选 {count} 条内容添加分类，已有分类与笔记保持不变。</p>
        <div className="type-tabs">
          {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
            <button
              key={k}
              className={kind === k ? 'selected' : ''}
              onClick={() => {
                setKind(k);
                setChosen([]);
              }}
            >
              {labels[k]}
            </button>
          ))}
        </div>
        <div className="choice-wrap">
          {meta[kind].map((t) => (
            <button
              key={t.id}
              aria-pressed={chosen.includes(t.id)}
              className={chosen.includes(t.id) ? 'selected' : ''}
              onClick={() =>
                setChosen((prev) =>
                  prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                )
              }
            >
              {t.name}
            </button>
          ))}
          {!meta[kind].length && <p className="muted">请先在设置中创建{labels[kind]}。</p>}
        </div>
        <div className="form-footer">
          <button onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="primary"
            disabled={!chosen.length || busy}
            onClick={() => onApply({ action: 'add', kind, taxonomyIds: chosen })}
          >
            {busy ? '应用中…' : '应用到所选条目'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
export function SettingsPanel({
  meta,
  initialSection = 'classification',
  initialKind = 'domains',
  onClose,
  onRefresh,
  notify,
  onRestore,
  onImport,
  onTrash,
  onTheme,
}: {
  meta: Meta;
  initialSection?: 'classification' | 'ai' | 'backup' | 'service' | 'drafts' | 'appearance';
  initialKind?: Kind;
  onClose: () => void;
  onRefresh: () => void;
  notify: (s: string) => void;
  onRestore: () => void;
  onImport?: () => void;
  onTrash?: () => void;
  onTheme?: () => void;
}) {
  const [cleanup, setCleanup] = useState(false),
    [parent, setParent] = useState(''),
    [domainRows, setDomainRows] = useState<any[]>([]);
  useEffect(() => {
    api('/library/domains')
      .then(setDomainRows)
      .catch(() => {});
  }, [meta]);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [section, setSection] = useState(initialSection);
  const sectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = sectionRef.current;
      panel?.closest('.dialog-body')?.scrollTo({ top: 0 });
      if (section === 'classification')
        panel
          ?.querySelector<HTMLInputElement>('input[aria-label="分类名称"]')
          ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, kind]);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false),
    [aiDirty, setAiDirty] = useState(false);
  const categoryDirty = editId
    ? name !== meta[kind].find((t) => t.id === editId)?.name ||
      (kind === 'domains' && parent !== (domainRows.find((d) => d.id === editId)?.parent_id || ''))
    : !!name.trim() || !!parent;
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<{ count: number; createdAt: string } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [wsFile, setWsFile] = useState<File | null>(null);
  const [wsInfo, setWsInfo] = useState<{
    type: 'workspace' | 'knowledge';
    createdAt?: string;
    count?: number;
    knowledge?: { count: number };
    tasks?: { count: number };
  } | null>(null);
  const [wsConfirm, setWsConfirm] = useState('');
  const [drafts, setDrafts] = useState<
    { key: string; title: string; savedAt: string; missingEntry: boolean }[]
  >([]);
  useEffect(() => {
    let current = true;
    api('/drafts')
      .then((value) => {
        if (current) setDrafts(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, []);
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
  return (
    <Dialog
      title="设置"
      wide
      onClose={() => {
        if (
          !busy &&
          !aiBusy &&
          (!aiDirty || confirm('AI 配置尚未保存，确认关闭？未提交的密钥将清空。')) &&
          (!categoryDirty || confirm('分类修改尚未保存，确认关闭并放弃修改？')) &&
          (!backupFile || confirm('备份恢复尚未执行，确认关闭？当前知识库不会改变。'))
        )
          onClose();
      }}
    >
      <div className="settings-panel" ref={sectionRef}>
        <div className="settings-nav" role="tablist" aria-label="设置分区">
          {(
            [
              ['classification', '分类管理'],
              ['ai', 'AI 服务'],
              ['backup', '数据与备份'],
              ['drafts', '草稿与编辑'],
              ['service', '本地运行'],
              ['appearance', '外观与说明'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={section === key}
              disabled={busy || aiBusy}
              onClick={() => {
                if (
                  section === 'classification' &&
                  categoryDirty &&
                  !confirm('分类修改尚未保存，确认切换分区？输入会保留至关闭设置。')
                )
                  return;
                setSection(key);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div hidden={section !== 'ai'} role="tabpanel" aria-label="AI 配置分区">
          <AiSettings onBusy={setAiBusy} onDirty={setAiDirty} />
        </div>
        <div hidden={section !== 'service'} role="tabpanel" aria-label="网站启停分区">
          <LocalServiceControl />
        </div>
        <div hidden={section !== 'classification'} role="tabpanel" aria-label="分类管理分区">
          <h3>整理你的知识空间</h3>
          <p className="muted">领域是知识方向，标签用于检索，专题围绕一个任务组织收藏。</p>
          <div className="type-tabs">
            {(['domains', 'tags', 'collections'] as Kind[]).map((k) => (
              <button
                key={k}
                disabled={busy}
                className={kind === k ? 'selected' : ''}
                onClick={() => {
                  if (categoryDirty && !confirm('分类修改尚未保存，确认放弃并切换分类？')) return;
                  setKind(k);
                  setParent('');
                  setName('');
                  setEditId('');
                }}
              >
                {labels[k]}
              </button>
            ))}
          </div>
          <form
            className="taxonomy-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/taxonomy/' + kind + (editId ? '/' + editId : ''), {
                  method: editId ? 'PUT' : 'POST',
                  body: JSON.stringify({
                    name,
                    ...(kind === 'domains' ? { parent_id: parent || null } : {}),
                  }),
                });
                setName('');
                setEditId('');
                setParent('');
                onRefresh();
                notify(editId ? '名称已更新' : '已创建' + labels[kind]);
              });
            }}
          >
            <input
              aria-label="分类名称"
              placeholder={'新的' + labels[kind] + '名称'}
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {kind === 'domains' && (
              <select
                aria-label="分类父领域"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">根领域</option>
                {domainRows
                  .filter(
                    (d) =>
                      d.id !== editId &&
                      !domainOutline(domainRows, editId).some((c) => c.id === d.id),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            )}
            <button className="primary" disabled={busy}>
              {editId ? '保存名称' : '创建'}
            </button>
            {editId && (
              <button
                type="button"
                onClick={() => {
                  setEditId('');
                  setName('');
                }}
              >
                取消
              </button>
            )}
          </form>
          <div className="taxonomy-list">
            {kind === 'domains' ? (
              <DomainTree
                rows={domainRows}
                selected={editId}
                onSelect={(d) => {
                  if (categoryDirty && !confirm('放弃未保存的分类修改，调整其他领域？')) return;
                  setEditId(d.id);
                  setName(d.name);
                  setParent(d.parent_id || '');
                }}
                actions={(d) => (
                  <>
                    <button
                      aria-label={'添加子领域 ' + d.name}
                      onClick={() => {
                        if (categoryDirty && !confirm('放弃未保存的分类修改？')) return;
                        setEditId('');
                        setName('');
                        setParent(d.id);
                      }}
                    >
                      ＋
                    </button>
                    <button
                      disabled={busy || !!d.count || domainRows.some((c) => c.parent_id === d.id)}
                      title="先调整内容归属和子领域；服务端会检查规则与视图引用"
                      onClick={() =>
                        run(async () => {
                          if (!confirm('删除空领域 ' + d.name + '？')) return;
                          await api('/taxonomy/domains/' + d.id, { method: 'DELETE' });
                          onRefresh();
                          notify('空领域已删除');
                        })
                      }
                    >
                      删除
                    </button>
                  </>
                )}
              />
            ) : (
              meta[kind].map((t) => (
                <div key={t.id}>
                  <span>
                    {t.name}
                    <small>{t.count} 条</small>
                  </span>
                  <button
                    aria-label={'改名 ' + t.name}
                    className="icon"
                    disabled={busy}
                    onClick={() => {
                      if (categoryDirty && !confirm('放弃未保存的分类修改，调整其他分类？')) return;
                      setEditId(t.id);
                      setName(t.name);
                      setParent(domainRows.find((d) => d.id === t.id)?.parent_id || '');
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={'删除分类 ' + t.name}
                    className="icon danger-text"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !confirm(
                          '删除' +
                            labels[kind] +
                            '「' +
                            t.name +
                            (kind === 'collections'
                              ? '」？会移除专题总结、历史和草稿；所有收藏与图片保留。请先备份。'
                              : '」？仅移除分类关联，所有条目与图片保留。'),
                        )
                      )
                        return;
                      run(async () => {
                        await api('/taxonomy/' + kind + '/' + t.id, { method: 'DELETE' });
                        if (editId === t.id) {
                          setEditId('');
                          setName('');
                        }
                        onRefresh();
                        notify('分类已删除，条目已保留');
                      });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
            {!meta[kind].length && (
              <p className="muted">还没有{labels[kind]}，从一个简单的名字开始。</p>
            )}
          </div>
        </div>
        <div hidden={section !== 'backup'} role="tabpanel" aria-label="备份与草稿分区">
          <h3>数据与备份</h3>
          <div className="settings-shortcuts">
            {onImport && <button onClick={onImport}>统一 JSON / 文本导入</button>}
            {onTrash && <button onClick={onTrash}>打开回收站</button>}
          </div>
          <button onClick={() => setCleanup(true)}>查看旧知识清理候选（只读）</button>
          <div className="storage-info">
            <span>软件版本</span>
            <strong>
              个人工作空间 {meta.workspaceVersion || '1.0.0'} · 知识库 {meta.version}
            </strong>
            <span>本地存储路径</span>
            <code>{meta.dataPath}</code>
          </div>
          <div className="workspace-backup">
            <h4>完整工作空间备份（知识库 + 任务台）</h4>
            <p className="muted">
              一次导出知识库数据库、附件、偏好与任务树。恢复前会分别校验知识库与任务库，再一起切换；任何一步失败都会回滚到当前数据。
            </p>
            <div className="settings-shortcuts">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const res = await fetch('/api/workspace/backup', {
                      method: 'POST',
                      headers: { 'X-PK-Request': '1' },
                    });
                    if (!res.ok) throw new Error((await res.json()).error);
                    const url = URL.createObjectURL(await res.blob());
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = '个人工作空间-' + new Date().toISOString().slice(0, 10) + '.zip';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                    notify('工作空间备份已导出');
                  })
                }
              >
                <Download size={17} />
                导出工作空间备份
              </button>
              <label className="button">
                选择工作空间备份
                <input
                  aria-label="导入工作空间备份"
                  disabled={busy}
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    setWsFile(f || null);
                    setWsInfo(null);
                    setWsConfirm('');
                    if (f)
                      run(async () => {
                        const fd = new FormData();
                        fd.append('backup', f);
                        setWsInfo(
                          await api('/workspace/restore/inspect', { method: 'POST', body: fd }),
                        );
                      });
                  }}
                />
              </label>
            </div>
            {wsFile && <small className="file-name">{wsFile.name}</small>}
            {wsInfo && (
              <div className="restore-confirm">
                <p>
                  {wsInfo.type === 'workspace'
                    ? `已校验：知识 ${wsInfo.knowledge?.count ?? 0} 条 · 任务 ${wsInfo.tasks?.count ?? 0} 条 · ${new Date(wsInfo.createdAt || Date.now()).toLocaleString('zh-CN')}`
                    : `旧版知识库备份：${wsInfo.count ?? 0} 条收藏。恢复只替换知识库，任务台数据不会改变。`}
                </p>
                <label>
                  输入「{wsInfo.type === 'workspace' ? '恢复工作空间' : '恢复当前知识库'}
                  」进行二次确认
                  <input
                    aria-label="工作空间恢复确认文字"
                    value={wsConfirm}
                    onChange={(e) => setWsConfirm(e.target.value)}
                  />
                </label>
                <button
                  className="danger"
                  disabled={
                    busy ||
                    !wsFile ||
                    wsConfirm !== (wsInfo.type === 'workspace' ? '恢复工作空间' : '恢复当前知识库')
                  }
                  onClick={() =>
                    run(async () => {
                      if (!wsFile || !wsInfo) return;
                      const fd = new FormData();
                      fd.append('backup', wsFile);
                      fd.append('confirm', wsConfirm);
                      if (wsInfo.type === 'workspace') {
                        await api('/workspace/restore', { method: 'POST', body: fd });
                        notify('工作空间恢复完成，正在重新加载…');
                        setTimeout(() => location.reload(), 900);
                      } else {
                        await api('/restore', { method: 'POST', body: fd });
                        setWsInfo(null);
                        setWsFile(null);
                        setWsConfirm('');
                        onRestore();
                        notify('知识库已恢复；任务台数据保持不变。');
                      }
                    })
                  }
                >
                  确认恢复
                </button>
              </div>
            )}
            <div className="task-import">
              <h4>兼容导入旧任务台 JSON</h4>
              <p className="muted">
                仅替换任务台数据，知识库不受影响；导入前自动保存当前任务快照，导入后核对数量与结构。
              </p>
              <label className="button">
                选择任务 JSON
                <input
                  aria-label="导入旧任务台备份"
                  disabled={busy}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    run(async () => {
                      let payload: any;
                      try {
                        payload = JSON.parse(await f.text());
                      } catch {
                        throw new Error('任务备份不是合法的 JSON');
                      }
                      const incoming = Array.isArray(payload) ? payload : payload?.tasks;
                      if (!Array.isArray(incoming)) throw new Error('任务备份缺少 tasks 任务列表');
                      if (
                        !confirm(
                          `将用备份中的 ${incoming.length} 个任务替换当前任务台数据，知识库不受影响。导入前会自动保存当前任务快照。确认继续？`,
                        )
                      )
                        return;
                      const result = await api('/workspace/tasks/import', {
                        method: 'POST',
                        body: JSON.stringify({ confirm: '导入任务备份', payload }),
                      });
                      notify(`任务导入完成：${result.count} 条；正在重新加载…`);
                      setTimeout(() => location.reload(), 900);
                    });
                  }}
                />
              </label>
            </div>
          </div>
          <p className="muted">
            下面的入口只备份/恢复知识库，与上面的完整工作空间备份互不影响。移除图片引用后，文件仍保留，避免其他笔记丢图。
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await fetch('/api/backup', {
                  method: 'POST',
                  headers: { 'X-PK-Request': '1' },
                });
                if (!res.ok) throw new Error((await res.json()).error);
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement('a');
                a.href = url;
                a.download = '知识收藏馆-' + new Date().toISOString().slice(0, 10) + '.zip';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                notify('备份已导出');
              })
            }
          >
            <Download size={17} />
            {busy ? '处理中…' : '导出完整备份'}
          </button>
          <div className="restore-box">
            <h4>
              <Upload size={17} />
              从备份恢复
            </h4>
            <p>
              恢复将替换当前收藏、分类、草稿与浏览偏好。系统会先自动备份当前数据，并保留旧库目录。
            </p>
            <label className="button">
              选择备份压缩包
              <input
                aria-label="导入备份"
                disabled={busy}
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setBackupFile(f || null);
                  setInspection(null);
                  setConfirmation('');
                  if (f)
                    run(async () => {
                      const fd = new FormData();
                      fd.append('backup', f);
                      setInspection(await api('/restore/inspect', { method: 'POST', body: fd }));
                    });
                }}
              />
            </label>
            {backupFile && <small className="file-name">{backupFile.name}</small>}
            {inspection && (
              <div className="restore-confirm">
                <p>
                  已校验：{inspection.count} 条收藏 ·{' '}
                  {new Date(inspection.createdAt).toLocaleString('zh-CN')}
                </p>
                <label>
                  输入「恢复当前知识库」进行二次确认
                  <input
                    aria-label="恢复确认文字"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <button
                  className="danger"
                  disabled={busy || confirmation !== '恢复当前知识库'}
                  onClick={() =>
                    run(async () => {
                      if (!backupFile) return;
                      const fd = new FormData();
                      fd.append('backup', backupFile);
                      fd.append('confirm', confirmation);
                      const result = await api('/restore', { method: 'POST', body: fd });
                      setInspection(null);
                      setBackupFile(null);
                      setConfirmation('');
                      onRestore();
                      notify('恢复成功；安全备份：' + result.safetyBackup);
                    })
                  }
                >
                  确认恢复
                </button>
              </div>
            )}
          </div>
        </div>
        <div hidden={section !== 'drafts'} role="tabpanel" aria-label="草稿与编辑分区">
          <h3>草稿与编辑保护</h3>
          <p className="muted">
            完整编辑器使用本地草稿与未保存关闭保护。快速记录自动保护独立临时草稿；刷新可恢复，正式保存仍需手动确认。AI
            审核草稿与正式内容独立，采用前需要确认。
          </p>
          {!drafts.length && <p>没有待恢复的普通编辑草稿。</p>}
          {!!drafts.length && (
            <>
              <hr />
              <h3>本地未保存草稿 · {drafts.length}</h3>
              <p className="muted">
                重新添加收藏或编辑对应条目可以恢复草稿。删除原条目时草稿仍保留；先导出备份，再清理不需要的草稿。
              </p>
              <div className="taxonomy-list">
                {drafts.map((d) => (
                  <div key={d.key}>
                    <span>
                      {d.title}
                      <small>
                        {d.missingEntry ? '原条目已删除 · ' : ''}
                        {d.savedAt ? new Date(d.savedAt).toLocaleString('zh-CN') : ''}
                      </small>
                    </span>
                    <button
                      className="icon danger-text"
                      disabled={busy}
                      aria-label={'丢弃草稿 ' + d.title}
                      onClick={() => {
                        if (
                          !confirm(
                            '永久丢弃「' +
                              d.title +
                              '」的未保存草稿？已保存的收藏、笔记和图片保留。',
                          )
                        )
                          return;
                        run(async () => {
                          if (d.key === 'quick') await discardQuickDraft();
                          else await api('/drafts/' + d.key, { method: 'DELETE' });
                          setDrafts((prev) => prev.filter((x) => x.key !== d.key));
                          notify('未保存草稿已丢弃');
                        });
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div hidden={section !== 'appearance'} role="tabpanel" aria-label="外观与说明分区">
          <h3>外观与浏览</h3>
          {onTheme && <button onClick={onTheme}>切换浅色 / 深色</button>}
          <p>
            列表 /
            网格与排序在知识库中调整；领域树折叠和侧栏收起保留浏览偏好。网站没有自动网页抓取或阅读进度估算。
          </p>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {cleanup && <CleanupInventory onClose={() => setCleanup(false)} />}
      </div>
    </Dialog>
  );
}
