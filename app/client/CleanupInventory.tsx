import { useEffect, useState } from 'react';
import { api } from './shared';
import { Dialog } from './components';
export function CleanupInventory({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api('/library/cleanup-candidates')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Dialog title="旧知识清理候选（只读）" wide onClose={onClose}>
      <div className="settings-panel">
        <p>
          先导出完整ZIP备份。下方列出旧知识对象供逐项核对；标题相近不能证明是可删除测试数据。当前不会执行删除，也不会修改正式知识归属。
        </p>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <p>{data.notice}</p>
            <button
              onClick={() => {
                const u = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = u;
                a.download = '旧知识清理候选.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 10000);
              }}
            >
              导出候选清单
            </button>
            {data.candidates.map((r: any) => (
              <details className="knowledge-source-box" key={r.id}>
                <summary>
                  {r.title} · {r.kind}
                </summary>
                <p>ID：{r.id}</p>
                <p>
                  来源{r.sources}份 / 专题{r.topics}个 / 子章节{r.children}个 / 原始日期{' '}
                  {r.original_date || '未知'}
                </p>
                <p>{r.reason}</p>
              </details>
            ))}
            <p>
              旧兼容目录：{data.legacyDirectories.length}
              个。确认需要清理后，请明确提供要删除的稳定ID清单；其他笔记、工具、收藏、专题与AI配置继续保留。
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
