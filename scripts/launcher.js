import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { acquireDataLock, inspectProcess } from '../app/server/lock.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(
  process.env.PW_DATA_DIR || process.env.PK_DATA_DIR || path.join(root, 'data'),
);
const port = Number(process.env.PORT || 5180);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid local port.');
  process.exit(1);
}
const base = 'http://127.0.0.1:' + port,
  file = path.join(dir, '.server-lock.json');
async function request(url, init = {}) {
  const r = await fetch(base + url, { ...init, signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw Error();
  return r.json();
}
async function listening() {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(500);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });
}
function portOwner() {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' } | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  const value = out.trim() ? JSON.parse(out) : [];
  return Array.isArray(value) ? value : [value];
}
async function probe() {
  if (existsSync(path.join(dir, '.server-lock-acquire.json')))
    throw Error(
      'A startup lock check is unfinished. Preserve the lock and verify the service; do not delete it.',
    );
  if (existsSync(file)) {
    let lock;
    try {
      lock = JSON.parse(readFileSync(file, 'utf8'));
      if (
        (lock.version !== undefined && lock.version !== 2) ||
        !Number.isSafeInteger(lock.pid) ||
        (lock.version === 2 && (!lock.identity?.startedAt || !lock.identity?.executable)) ||
        typeof lock.token !== 'string'
      )
        throw Error();
    } catch {
      throw Error(
        'The data lock cannot be safely confirmed. Preserve it and inspect the original startup window.',
      );
    }
    const owner = inspectProcess(lock.pid);
    if (owner.state === 'unknown')
      throw Error(
        'Unable to inspect the locked process. Check Windows permissions; the lock was preserved.',
      );
    if (
      lock.version === undefined &&
      owner.state === 'alive' &&
      /^node(?:\.exe)?$/i.test(owner.name || '')
    )
      throw Error(
        'A legacy lock belongs to a Node process with unknown identity. Preserve it; stop the original service normally.',
      );
    const same =
      lock.version === 2 &&
      owner.state === 'alive' &&
      owner.startedAt === lock.identity.startedAt &&
      owner.executable.toLowerCase() === lock.identity.executable.toLowerCase();
    if (same) {
      if (!(await listening()))
        throw Error(
          'The data directory has a live service on another port, or it is still starting. Do not start a second instance.',
        );
      if (!portOwner().includes(lock.pid))
        throw Error('Another application owns the requested port. No process was stopped.');
      let meta;
      try {
        meta = await request('/api/meta');
      } catch {
        throw Error(
          'The locked service is not responding normally. Wait or stop it normally in the original window.',
        );
      }
      if (
        path.resolve(meta.dataPath || '').toLowerCase() !== dir.toLowerCase() ||
        meta.workspaceVersion !== '1.0.0'
      )
        throw Error(
          'The port belongs to a different application or data directory. No process was stopped.',
        );
      let legacy = true;
      try {
        const instance = await request('/api/local/instance', {
          headers: { 'X-PK-Instance': lock.token },
        });
        if (
          instance.application !== 'PersonalWorkspace' ||
          instance.pid !== lock.pid ||
          path.resolve(instance.projectRoot).toLowerCase() !== root.toLowerCase()
        )
          throw Error();
        legacy = false;
      } catch {
        if (meta.workspaceVersion === '1.0.0')
          throw Error('The project instance could not be authenticated. Preserve the lock.');
      }
      return { running: true, legacy };
    }
  }
  if (await listening())
    throw Error(
      'The requested port is occupied by another application. No process was stopped; choose another PORT or close that application yourself.',
    );
  return { running: false };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function stop() {
  const state = await probe();
  if (!state.running) {
    console.log('个人工作空间当前未运行。');
    return;
  }
  if (state.legacy)
    throw Error('旧版服务需在原启动窗口按 Ctrl+C 正常停止一次，再双击启动更新；未强制结束进程。');
  const session = await request('/api/local/session', { headers: { 'X-PK-Request': '1' } });
  await request('/api/local/shutdown', {
    method: 'POST',
    headers: {
      'X-PK-Request': '1',
      'X-PK-Session': session.token,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirm: '停止个人工作空间' }),
  });
  for (let i = 0; i < 50; i++) {
    if (!existsSync(file) && !(await listening())) {
      console.log('个人工作空间已正常停止，数据和安全配置已保留。');
      return;
    }
    await pause(200);
  }
  throw Error(
    'Shutdown is taking longer than expected. Preserve the lock and wait; no process was killed.',
  );
}
function digest() {
  const h = createHash('sha256');
  const add = (p) => {
    h.update(p);
    h.update(readFileSync(path.join(root, p)));
  };
  const walk = (d) => {
    for (const item of readdirSync(path.join(root, d), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = path.join(d, item.name);
      if (item.isDirectory()) walk(p);
      else add(p);
    }
  };
  walk('app/client');
  for (const p of [
    'package-lock.json',
    'package.json',
    'vite.config.ts',
    'tsconfig.json',
    'index.html',
  ])
    add(p);
  return h.digest('hex');
}
async function run(command) {
  await new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', command], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => reject(Error('Unable to execute npm.')));
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error('Installation/build failed; personal data was not changed.')),
    );
  });
}
async function start() {
  mkdirSync(dir, { recursive: true });
  let release;
  try {
    release = acquireDataLock(path.join(dir, '.launcher'));
  } catch {
    for (let i = 0; i < 60; i++) {
      await pause(1000);
      try {
        if ((await probe()).running) {
          console.log('首次启动已完成，复用同一后台服务。');
          return;
        }
      } catch {}
      try {
        release = acquireDataLock(path.join(dir, '.launcher'));
        break;
      } catch {}
    }
    if (!release)
      throw Error(
        'Another launch is in progress or its launcher lock is ambiguous. Preserve the lock and inspect before retrying.',
      );
  }
  try {
    const initial = await probe();
    if (initial.running) {
      console.log(
        initial.legacy
          ? '旧版知识库正在运行；请在原窗口 Ctrl+C 停止一次后重开，以使用新设置。'
          : '个人工作空间已经正常运行，正在打开网页；不会重复启动。',
      );
      return;
    }
    if (!existsSync(path.join(root, 'node_modules'))) {
      console.log('Installing locked dependencies...');
      await run('npm.cmd ci');
    }
    const fingerprint = digest(),
      stamp = path.join(root, 'dist', '.build-stamp');
    if (
      !existsSync(path.join(root, 'dist', 'index.html')) ||
      !existsSync(stamp) ||
      readFileSync(stamp, 'utf8') !== fingerprint
    ) {
      console.log('Building the local website...');
      await run('npm.cmd run build');
      writeFileSync(stamp, fingerprint);
    }
    const out = openSync(path.join(dir, '.server-startup.log'), 'a'),
      err = openSync(path.join(dir, '.server-startup-error.log'), 'a');
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, 'app/server/index.js')], {
        cwd: root,
        env: process.env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', out, err],
      });
      child.unref();
    } finally {
      closeSync(out);
      closeSync(err);
    }
    for (let i = 0; i < 60; i++) {
      await pause(500);
      try {
        if ((await probe()).running) {
          console.log(
            '个人工作空间已在后台启动，此窗口可关闭。正常停止请使用「停止个人工作空间.bat」或网页设置。',
          );
          return;
        }
      } catch {}
      if (child.exitCode !== null) break;
    }
    throw Error(
      'The backend could not become ready. Check .server-startup-error.log; preserve data and locks. No process was forcibly stopped.',
    );
  } finally {
    release();
  }
}
try {
  if (process.argv.includes('--probe')) {
    const state = await probe();
    console.log(JSON.stringify(state));
    process.exitCode = state.running ? 0 : 10;
  } else if (process.argv.includes('--stop')) await stop();
  else await start();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
