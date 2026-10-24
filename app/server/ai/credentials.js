import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  lstatSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { AiError, readAiConfig, providerSettings } from './provider.js';
const script = fileURLToPath(new URL('../../../scripts/dpapi.ps1', import.meta.url));
export function windowsProtection(operation, input) {
  if (process.platform !== 'win32') throw new AiError('secure_storage');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_API_KEY;
  try {
    const output = execFileSync(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Operation',
        operation,
      ],
      {
        input: input.toString('base64'),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 16384,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(output)) throw Error();
    return Buffer.from(output, 'base64');
  } catch {
    throw new AiError('secure_storage');
  }
}
const validKey = (key) =>
  typeof key === 'string' && key.length > 0 && key.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(key);
export function createCredentials(
  dir,
  { env = process.env, credentialDir, protection = windowsProtection } = {},
) {
  const base =
    credentialDir ||
    (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'PersonalKnowledge', 'AI') : null);
  const name =
    createHash('sha256').update(path.resolve(dir).toLowerCase()).digest('hex') + '.dpapi.json';
  const file = base ? path.join(base, name) : null;
  let failure = '',
    ephemeralTest = null;
  function read() {
    if (!file || !existsSync(file)) return null;
    try {
      if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 32768) throw Error();
      const v = JSON.parse(readFileSync(file, 'utf8'));
      if (
        v.version !== 1 ||
        typeof v.revision !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.revision) ||
        !Object.hasOwn(providerSettings, v.provider) ||
        !providerSettings[v.provider].models.includes(v.model) ||
        !v.keys ||
        Object.keys(v.keys).some((k) => !Object.hasOwn(providerSettings, k)) ||
        Object.values(v.keys).some(
          (k) =>
            k !== null &&
            (typeof k !== 'string' || k.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(k)),
        )
      )
        throw Error();
      if (
        v.lastTest &&
        (typeof v.lastTest.at !== 'string' ||
          Object.keys(v.lastTest).some((k) => !['at', 'state', 'code'].includes(k)) ||
          !Number.isFinite(Date.parse(v.lastTest.at)) ||
          !['success', 'error'].includes(v.lastTest.state) ||
          ![
            'success',
            'not_configured',
            'secure_storage',
            'config',
            'timeout',
            'cancelled',
            'network',
            'upstream',
            'invalid_key',
            'balance',
            'model',
            'rate',
            'upstream_rate',
            'refusal',
            'invalid_output',
            'usage_storage',
            'busy',
          ].includes(v.lastTest.code))
      )
        throw Error();
      return v;
    } catch {
      throw new AiError('secure_storage');
    }
  }
  function decrypt(blob, provider) {
    try {
      const bytes = protection('unprotect', Buffer.from(blob, 'base64'));
      const payload = JSON.parse(bytes.toString('utf8'));
      bytes.fill(0);
      if (payload.provider !== provider || payload.scope !== name || !validKey(payload.key))
        throw Error();
      failure = '';
      return payload.key;
    } catch {
      failure = new AiError('secure_storage').message;
      throw new AiError('secure_storage');
    }
  }
  function verify(v) {
    for (const [provider, blob] of Object.entries(v?.keys || {})) if (blob) decrypt(blob, provider);
  }
  function write(v) {
    if (!file || (!credentialDir && process.platform !== 'win32'))
      throw new AiError('secure_storage');
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      mkdirSync(base, { recursive: true });
      writeFileSync(tmp, JSON.stringify(v), { flag: 'wx', mode: 0o600 });
      renameSync(tmp, file);
      failure = '';
      ephemeralTest = null;
    } catch {
      try {
        unlinkSync(tmp);
      } catch {}
      throw new AiError('secure_storage');
    }
  }
  function publicState() {
    try {
      const v = read();
      return {
        source: v ? 'windows' : 'environment',
        revision: v?.revision || 'environment',
        provider: v?.provider || env.PK_AI_PROVIDER || 'openai',
        model: v?.model || '',
        saved: !!v,
        keys: v
          ? Object.fromEntries(Object.entries(providerSettings).map(([p]) => [p, !!v.keys[p]]))
          : Object.fromEntries(
              Object.entries(providerSettings).map(([p, s]) => [p, !!env[s.keyName]]),
            ),
        lastTest: ephemeralTest || v?.lastTest || null,
        storageError: failure,
      };
    } catch {
      return {
        source: 'windows',
        revision: 'error',
        provider: 'openai',
        model: '',
        saved: true,
        keys: { openai: false, deepseek: false },
        lastTest: ephemeralTest,
        storageError: new AiError('secure_storage').message,
      };
    }
  }
  function config(withKey = false) {
    const v = read();
    if (!v)
      return readAiConfig({
        ...env,
        ...(!withKey ? { OPENAI_API_KEY: '', DEEPSEEK_API_KEY: '' } : {}),
      });
    const settings = providerSettings[v.provider];
    return readAiConfig({
      ...env,
      PK_AI_PROVIDER: v.provider,
      PK_AI_MODEL: v.model,
      PK_AI_ENDPOINT: settings.endpoint,
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      [settings.keyName]:
        withKey && v.keys[v.provider] ? decrypt(v.keys[v.provider], v.provider) : '',
    });
  }
  function update(input) {
    if (
      !input ||
      !Object.hasOwn(providerSettings, input.provider) ||
      !providerSettings[input.provider].models.includes(input.model) ||
      !['keep', 'replace', 'clear'].includes(input.action)
    )
      throw new AiError('config');
    const current = read();
    if (input.revision !== (current?.revision || 'environment'))
      throw new AiError('config_changed');
    if (
      input.action !== 'keep' &&
      input.confirm !== (input.action === 'clear' ? '清除密钥' : '保存或替换密钥')
    )
      throw new AiError('confirmation');
    verify(current); // Never overwrite or delete credentials that cannot be decrypted.
    const keys = { openai: null, deepseek: null, ...current?.keys };
    if (input.action === 'replace') {
      if (!validKey(input.key)) throw new AiError('key_input');
      const bytes = Buffer.from(
        JSON.stringify({ provider: input.provider, scope: name, key: input.key }),
        'utf8',
      );
      try {
        keys[input.provider] = protection('protect', bytes).toString('base64');
        decrypt(keys[input.provider], input.provider);
      } finally {
        bytes.fill(0);
      }
    } else if (input.action === 'clear') keys[input.provider] = null;
    // First UI save deliberately does NOT import or silently fall back to environment keys.
    write({
      version: 1,
      revision: randomUUID(),
      provider: input.provider,
      model: input.model,
      keys,
      lastTest: null,
    });
    return publicState();
  }
  function testResult(revision, result) {
    if (result === 'secure_storage') {
      failure = new AiError('secure_storage').message;
      ephemeralTest = { at: new Date().toISOString(), state: 'error', code: result };
      return;
    }
    const current = read();
    if (!current && revision === 'environment') {
      ephemeralTest = {
        at: new Date().toISOString(),
        state: result === 'success' ? 'success' : 'error',
        code: result,
      };
      return;
    }
    if (!current || current.revision !== revision) return;
    write({
      ...current,
      lastTest: {
        at: new Date().toISOString(),
        state: result === 'success' ? 'success' : 'error',
        code: result,
      },
    });
  }
  return { publicState, config, update, testResult };
}
