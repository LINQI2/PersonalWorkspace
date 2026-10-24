import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deepSeekFixtureKey } from './ai-fixture.js';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { legacyStore, seedEntry } from './v13-fixture.js';
import { saveEntry } from '../app/server/store.js';
if (process.platform !== 'win32') throw new Error('此验收必须在 Windows 执行。');
const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-startup-'));
const legacyDb = legacyStore(dir);
const legacyNote = seedEntry(legacyDb, {
  type: 'note',
  title: 'Windows 旧库笔记',
  url: '',
  description: '',
  content: '<p>旧内容无损迁移。</p>',
  domains: [],
  tags: [],
  collections: [],
});
legacyDb.close();
const root = process.cwd();
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await new Promise((resolve) => probe.once('listening', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = 'http://127.0.0.1:' + port;
const launchEnv = {
  ...process.env,
  PORT: String(port),
  PK_DATA_DIR: dir,
  LOCALAPPDATA: path.join(dir, 'isolated-user'),
  OPENAI_API_KEY: '',
  DEEPSEEK_API_KEY: '',
  PK_AI_PROVIDER: 'openai',
  PK_AI_MODEL: '',
  PK_AI_ENDPOINT: '',
  NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tests/mock-cloud-preload.js')).href,
};
async function launch() {
  let output = '';
  const child = spawn('cmd.exe', ['/d', '/c', '启动知识库.bat', '-NoBrowser'], {
    cwd: root,
    env: launchEnv,
    windowsHide: true,
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  for (let n = 0; n < 120; n++) {
    try {
      const res = await fetch(base + '/api/meta');
      if (res.ok) {
        assert.equal((await res.json()).dataPath, path.resolve(dir));
        if (child.exitCode === null)
          await new Promise((resolve, reject) =>
            child.once('exit', (code) => (code === 0 ? resolve() : reject(Error(output)))),
          );
        return;
      }
    } catch {}
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error(output);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('启动超时：' + output);
}
async function stop(force = false) {
  if (existsSync(path.join(dir, '.server-lock.json'))) {
    if (!force) {
      await new Promise((resolve, reject) =>
        execFile(
          process.execPath,
          ['scripts/launcher.js', '--stop'],
          { cwd: root, env: launchEnv, windowsHide: true },
          (e) => (e ? reject(e) : resolve()),
        ),
      );
      return;
    }
    const lock = JSON.parse(readFileSync(path.join(dir, '.server-lock.json'), 'utf8'));
    await new Promise((resolve, reject) =>
      execFile(
        'taskkill.exe',
        ['/PID', String(lock.pid), '/T', '/F'],
        { windowsHide: true },
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    await new Promise((r) => setTimeout(r, 350));
  }
}
try {
  await Promise.all([launch(), launch()]);
  const firstPid = JSON.parse(readFileSync(path.join(dir, '.server-lock.json'), 'utf8')).pid;
  await launch();
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.server-lock.json'), 'utf8')).pid, firstPid);
  const session = (
    await (await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })).json()
  ).token;
  const credentialsHeaders = {
    'Content-Type': 'application/json',
    'X-PK-Request': '1',
    'X-PK-Session': session,
    Origin: base,
  };
  assert.equal(
    (
      await fetch(base + '/api/ai/config', {
        method: 'PUT',
        headers: credentialsHeaders,
        body: JSON.stringify({
          provider: 'deepseek',
          model: 'deepseek-flash',
          action: 'replace',
          key: deepSeekFixtureKey,
          revision: 'environment',
          confirm: '保存或替换密钥',
        }),
      })
    ).status,
    200,
  );
  assert.equal((await (await fetch(base + '/api/meta')).json()).schemaVersion, 11);
  assert.equal(
    (await (await fetch(base + '/api/entries/' + legacyNote.id)).json()).content,
    legacyNote.content,
  );
  const duplicate = spawn(process.execPath, ['app/server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PK_DATA_DIR: dir },
    windowsHide: true,
  });
  let duplicateOutput = '';
  duplicate.stderr.on('data', (d) => (duplicateOutput += d));
  const duplicateCode = await new Promise((r) => duplicate.on('exit', r));
  assert.equal(duplicateCode, 1);
  assert.match(duplicateOutput, /已有服务运行/);
  const input = {
    type: 'bookmark',
    title: 'Windows 启动持久化测试',
    url: 'https://www.douyin.com/video/123',
    description: '手工标题，不抓取',
    content: '<h2>启动演练</h2><p>重启后保留。</p>',
    domains: [],
    tags: [],
    collections: [],
  };
  const res = await fetch(base + '/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PK-Request': '1' },
    body: JSON.stringify(input),
  });
  assert.equal(res.status, 200);
  const saved = await res.json();
  await stop(true);
  await launch();
  const restored = await (await fetch(base + '/api/entries/' + saved.id)).json();
  assert.equal(restored.title, input.title);
  assert.equal(restored.content, input.content);
  const aiState = await (await fetch(base + '/api/ai/status')).json();
  assert.equal(aiState.provider, 'deepseek');
  assert.equal(aiState.configured, true);
  const restartedSession = (
    await (await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })).json()
  ).token;
  assert.equal(
    (
      await fetch(base + '/api/ai/test', {
        method: 'POST',
        headers: { ...credentialsHeaders, 'X-PK-Session': restartedSession },
        body: JSON.stringify({ confirm: '测试连接可能产生费用' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await fetch(base + '/api/ai/status')).json()).settings.lastTest.state,
    'success',
  );
  await stop();
  assert.equal(existsSync(path.join(dir, '.server-lock.json')), false);
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const missing = spawn(
    ps,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'scripts/start.ps1'),
      '-CheckOnly',
    ],
    {
      cwd: root,
      env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') },
      windowsHide: true,
    },
  );
  let missingOutput = '';
  missing.stdout.on('data', (d) => (missingOutput += d));
  missing.stderr.on('data', (d) => (missingOutput += d));
  const code = await new Promise((resolve) => missing.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(missingOutput, /Node.js was not found/);
  console.log(
    'PASS: real Windows background launch/reuse/same PID; direct duplicate rejected; synthetic DPAPI key and old note/bookmark survived backend crash and restart; mock connection succeeded; normal Stop released lock; missing Node reported. No paid API or browser auto-open.',
  );
} finally {
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
