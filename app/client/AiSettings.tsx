import { useEffect, useRef, useState } from 'react';
import { api } from './shared';
const testErrors: Record<string, string> = {
  invalid_key: '认证被拒，请核对密钥',
  balance: '余额不足',
  model: '模型不可用',
  upstream_rate: '上游限流，请核对配额',
  network: '网络连接失败',
  timeout: '请求超时',
  cancelled: '已取消',
  secure_storage: '安全凭据无法读取/解密',
  usage_storage: '用量文件无法读写',
  not_configured: '未配置',
  upstream: '上游返回错误，具体原因未知',
  invalid_output: '返回结构无效',
  rate: '达到本机小时上限',
  config: '配置无效',
  busy: '另一个请求处理中',
  refusal: '上游未能提供结果',
};
type Status = {
  configured: boolean;
  message: string;
  provider: string;
  model: string;
  settings: {
    source: string;
    revision: string;
    keys: Record<string, boolean>;
    saved: boolean;
    storageError: string;
    lastTest: { at: string; state: string; code: string } | null;
  };
  providers: Record<string, { models: string[]; endpoint: string }>;
  lastSuccess: string | null;
  usage: {
    recordedRequests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedUSD: number;
    unknownUsage: number;
  };
  limits?: {
    timeoutMs: number;
    maxInputChars: number;
    maxOutputTokens: number;
    maxCallsPerHour: number;
  } | null;
};
export async function protectedApi(
  url: string,
  body: object,
  method = 'POST',
  signal?: AbortSignal,
) {
  const session = await api<{ token: string }>('/local/session');
  return api<Status>(url, {
    method,
    signal,
    headers: { 'X-PK-Session': session.token },
    body: JSON.stringify(body),
  });
}
export function AiSettings({
  onBusy,
  onDirty,
}: {
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>(),
    [provider, setProvider] = useState('deepseek'),
    [model, setModel] = useState('deepseek-flash'),
    [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const baseline = useRef({ provider: '', model: '' });
  const load = async () => {
    const s = await api<Status>('/ai/status');
    if (!s.settings)
      throw Error('当前后台仍是旧版。请在原启动窗口按 Ctrl+C 正常停止一次，再双击启动脚本。');
    setStatus(s);
    baseline.current = {
      provider: s.provider,
      model: s.model || s.providers[s.provider].models[0],
    };
    setProvider(s.provider);
    setModel(s.model || s.providers[s.provider].models[0]);
    return s;
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => controller.current?.abort();
  }, []);
  useEffect(() => onBusy(busy), [busy]);
  useEffect(
    () =>
      onDirty(
        !!key ||
          (!!status &&
            (provider !== baseline.current.provider || model !== baseline.current.model)),
      ),
    [key, provider, model, status],
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await fn();
      window.dispatchEvent(new Event('pk-ai-config'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setKey('');
    }
  };
  const save = (action: 'keep' | 'replace' | 'clear') => {
    if (!status) return;
    if (
      action === 'replace' &&
      !confirm(
        '确认安全保存或替换 ' +
          (provider === 'deepseek' ? 'DeepSeek' : 'OpenAI') +
          ' 密钥？旧密钥将由新密钥替换；不会自动调用 API。',
      )
    )
      return;
    if (
      action === 'clear' &&
      !confirm('确认清除所选 Provider 的密钥？不会回退使用旧环境变量，手动收藏仍可使用。')
    )
      return;
    run(async () => {
      const s = await protectedApi(
        '/ai/config',
        {
          provider,
          model,
          action,
          revision: status.settings.revision,
          ...(action === 'replace' ? { key } : {}),
          confirm: action === 'clear' ? '清除密钥' : '保存或替换密钥',
        },
        'PUT',
      );
      setStatus(s);
      baseline.current = {
        provider: s.provider,
        model: s.model || s.providers[s.provider].models[0],
      };
      setProvider(baseline.current.provider);
      setModel(baseline.current.model);
      setFeedback('已安全保存配置；无需重启，不会自动请求模型。');
    });
  };
  return (
    <section className="ai-settings" aria-label="AI 安全配置">
      <h3>AI 配置 · 可选</h3>
      <p className="muted">
        首次选择 DeepSeek，输入密钥并安全保存。密钥由当前 Windows 用户的 DPAPI
        加密，关闭终端后仍保留；不进入知识库备份。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="ai-feedback" role="status">
          {feedback}
        </p>
      )}
      {status && (
        <>
          <div className="ai-status-summary">
            <strong>
              {status.configured
                ? status.settings.lastTest?.state === 'error'
                  ? '已配置 · 最近连接测试失败'
                  : status.settings.lastTest?.state === 'success'
                    ? '已配置 · 最近连接测试成功'
                    : '已配置（不代表连接成功）'
                : 'AI 未就绪'}
            </strong>
            <span>
              当前：{status.provider} · {status.model}
            </span>
            <small>
              {status.settings.saved
                ? '使用 Windows 安全保存配置，优先于环境变量'
                : '使用临时环境变量；从别处双击启动可能不会继承'}
            </small>
            {status.message && <p>{status.message}</p>}
          </div>
          <fieldset disabled={busy}>
            <div className="ai-config-fields">
              <label>
                提供商
                <select
                  aria-label="AI 提供商"
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setProvider(p);
                    setModel(status.providers[p].models[0]);
                    setKey('');
                  }}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                模型
                <select
                  aria-label="AI 模型"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {status.providers[provider].models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              所选密钥：{status.settings.keys[provider] ? '已配置，仅显示状态' : '未配置'} ·
              Endpoint 固定白名单
            </p>
            <label>
              新 API Key
              <input
                aria-label="新 API Key"
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                maxLength={512}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="仅用于本次安全提交，不会回显已保存密钥"
              />
            </label>
            <div className="ai-config-actions">
              <button className="primary" disabled={!key} onClick={() => save('replace')}>
                安全保存或替换密钥
              </button>
              <button onClick={() => save('keep')}>应用 Provider 和模型</button>
              <button disabled={!status.settings.keys[provider]} onClick={() => save('clear')}>
                清除所选密钥
              </button>
            </div>
          </fieldset>
          <p className="muted">
            首次保存网页配置后，不再使用任何旧环境变量密钥；另一家 Provider
            需要分别安全输入。请勿让浏览器密码管理器保存此输入。
          </p>
          <div className="ai-connection">
            <button
              disabled={
                busy ||
                !status.configured ||
                provider !== status.provider ||
                model !== status.model ||
                !!key
              }
              onClick={() => {
                if (
                  !confirm(
                    '测试连接将发送极短测试文字，不含收藏资料，可能产生少量 API 费用。确认主动测试？',
                  )
                )
                  return;
                const c = new AbortController();
                controller.current = c;
                setTesting(true);
                run(async () => {
                  try {
                    const s = await protectedApi(
                      '/ai/test',
                      { confirm: '测试连接可能产生费用' },
                      'POST',
                      c.signal,
                    );
                    setStatus(s);
                    setFeedback('连接测试成功：真实请求返回了有效结构。整理内容质量仍需人工核对。');
                  } finally {
                    setTesting(false);
                    await load().catch(() => {});
                  }
                });
              }}
            >
              {' '}
              {testing ? '正在测试…' : '测试连接（可能产生费用）'}
            </button>
            {testing && <button onClick={() => controller.current?.abort()}>取消连接测试</button>}
            <p>
              最近连接测试：
              {status.settings.lastTest
                ? `${status.settings.lastTest.state === 'success' ? '成功' : '失败（' + (testErrors[status.settings.lastTest.code] || '需要核对原因') + '）'} · ${new Date(status.settings.lastTest.at).toLocaleString('zh-CN')}`
                : '尚未测试'}
            </p>
            <p>
              本机最近生成候选成功（历史）：
              {status.lastSuccess
                ? new Date(status.lastSuccess).toLocaleString('zh-CN')
                : '暂无记录'}
            </p>
          </div>
          <details>
            <summary>请求用量与参考费用</summary>
            <p>
              记录 {status.usage.recordedRequests} 次（包括连接测试） · 输入{' '}
              {status.usage.inputTokens} / 输出 {status.usage.outputTokens} Token · 参考 $
              {status.usage.estimatedUSD.toFixed(6)} · 未知用量 {status.usage.unknownUsage}{' '}
              次。仅为参考，实际以供应商账单为准。
            </p>
          </details>
          <details>
            <summary>调用限制</summary>
            {status.limits ? (
              <p>
                单次输入上限 {status.limits.maxInputChars} 字符 · 最大输出{' '}
                {status.limits.maxOutputTokens} Token · 每小时最多 {status.limits.maxCallsPerHour}{' '}
                次 · 超时 {status.limits.timeoutMs / 1000}{' '}
                秒。由服务端配置控制；不会后台调用或自动重试。
              </p>
            ) : (
              <p>当前配置不可用，请核对提供商和服务端配置。</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
export function AiStatusBadge({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    const load = () =>
      api<Status>('/ai/status')
        .then(setStatus)
        .catch(() => setStatus(undefined));
    load();
    window.addEventListener('pk-ai-config', load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('pk-ai-config', load);
      window.removeEventListener('focus', load);
    };
  }, []);
  return (
    <button
      className="ai-status-badge"
      onClick={onOpen}
      title={status?.message || '查看 AI 配置、连接测试与用量'}
    >
      AI ·{' '}
      {status
        ? status.configured
          ? status.settings?.lastTest?.state === 'success'
            ? '最近测试成功'
            : status.settings?.lastTest?.state === 'error'
              ? '测试失败'
              : '已配置'
          : '未配置'
        : '状态待检查'}
    </button>
  );
}
export function LocalServiceControl() {
  const [canStop, setCanStop] = useState(false),
    [error, setError] = useState(''),
    [stopped, setStopped] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ canStop: boolean }>('/local/status')
      .then((s) => setCanStop(s.canStop))
      .catch(() => {});
  }, []);
  return (
    <section className="local-service">
      <h3>本地网站运行</h3>
      <p className="muted">
        关闭网页或启动窗口不会停止后台。使用此处或「停止知识库.bat」正常停止；下次双击启动即可继续。停止前保存其他页面的编辑内容。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stopped ? (
        <p role="status">网站已收到停止请求，请关闭网页。下次双击启动脚本继续。</p>
      ) : (
        <button
          disabled={!canStop || busy}
          onClick={async () => {
            if (
              !confirm('确认停止当前知识库网站？请先保存其他标签页内容；进行中的 AI 请求会取消。')
            )
              return;
            setBusy(true);
            try {
              await protectedApi('/local/shutdown', { confirm: '停止知识库' });
              setStopped(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          正常停止网站
        </button>
      )}
    </section>
  );
}
