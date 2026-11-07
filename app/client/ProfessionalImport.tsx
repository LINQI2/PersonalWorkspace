import { useState } from 'react';
import { Dialog } from './components';
import { api } from './shared';
export async function professionalWrite(path: string, body: any) {
  const s = await api('/local/session');
  return api('/professional/' + path, {
    method: 'POST',
    headers: { 'X-PK-Session': s.token },
    body: JSON.stringify(body),
  });
}
export function ProfessionalImport({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [ids, setIds] = useState<string[]>([]),
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
    if (preview) void professionalWrite('import/cancel', { token: preview.token }).catch(() => {});
    onClose();
  };
  return (
    <Dialog title="专业知识导入" onClose={close}>
      <p>
        使用 professional-knowledge-v1
        JSON；领域只能选择现有专业领域ID。预览、人工选择后仅新建待审核知识，保留原记录。格式见专业知识读取手册。
      </p>
      {error && <p role="alert">{error}</p>}
      <input
        aria-label="选择专业知识JSON"
        type="file"
        accept=".json,application/json"
        disabled={busy}
        onChange={(e) =>
          run(async () => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 512 * 1024) throw Error('文件超过512KiB');
            setRaw(await f.text());
            setPreview(null);
            setIds([]);
          })
        }
      />
      <label>
        专业JSON
        <textarea
          rows={12}
          value={raw}
          disabled={busy}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(null);
            setIds([]);
          }}
        />
      </label>
      <button
        disabled={busy || !raw.trim()}
        onClick={() =>
          run(async () => {
            setPreview(await professionalWrite('import/preview', { raw }));
            setIds([]);
          })
        }
      >
        校验并预览
      </button>
      {preview && (
        <>
          <p>{preview.notice}</p>
          {preview.items.map((i: any) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={ids.includes(i.id)}
                disabled={busy}
                onChange={(e) =>
                  setIds((v) => (e.target.checked ? [...v, i.id] : v.filter((id) => id !== i.id)))
                }
              />
              {i.title}
              <p>{i.description}</p>
              <small>{i.sources.map((s: any) => s.title + ' ' + s.url).join('；')}</small>
              {!!i.duplicates.length && (
                <p>同名记录：{i.duplicates.map((d: any) => d.title).join('、')}</p>
              )}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={duplicate}
              onChange={(e) => setDuplicate(e.target.checked)}
            />
            发现同名时明确另存新知识
          </label>
          <button
            disabled={busy || !ids.length}
            onClick={() =>
              run(async () => {
                await professionalWrite('import/commit', {
                  token: preview.token,
                  ids,
                  confirm: '确认导入专业知识',
                  duplicate: duplicate ? '另存新知识' : undefined,
                });
                onSaved();
                onClose();
              })
            }
          >
            确认导入专业知识
          </button>
        </>
      )}
    </Dialog>
  );
}
