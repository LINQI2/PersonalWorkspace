import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { inspectProcess } from '../app/server/lock.js';
test('launcher refuses another port owner and ambiguous/corrupt locks; recognizes dead and reused PID without deleting lock', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-launch-probe-')),
    file = path.join(dir, '.server-lock.json');
  const server = http.createServer((req, res) => {
    res.end('Another application');
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const probe = () =>
    new Promise((resolve) =>
      execFile(
        process.execPath,
        ['scripts/launcher.js', '--probe'],
        {
          cwd: process.cwd(),
          env: { ...process.env, PK_DATA_DIR: dir, PORT: String(port) },
          windowsHide: true,
          timeout: 20000,
        },
        (e, out, err) => resolve({ code: e?.code || 0, out, err }),
      ),
    );
  try {
    let result = await probe();
    assert.equal(result.code, 1);
    assert.match(result.err, /occupied by another application/);
    assert.equal(server.listening, true);
    assert.equal(existsSync(path.join(dir, 'library.sqlite')), false);
    await new Promise((r) => server.close(r));
    assert.equal((await probe()).code, 10);
    writeFileSync(file, 'broken');
    result = await probe();
    assert.equal(result.code, 1);
    assert.equal(readFileSync(file, 'utf8'), 'broken');
    const legacy = { pid: process.pid, token: 'synthetic-token' };
    writeFileSync(file, JSON.stringify(legacy));
    assert.equal((await probe()).code, 1);
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(legacy));
    writeFileSync(file, JSON.stringify({ pid: 99999999, token: 'synthetic-token' }));
    assert.equal((await probe()).code, 10);
    assert.equal(existsSync(file), true);
    const identity = inspectProcess(process.pid);
    const reused = {
      version: 2,
      pid: process.pid,
      token: 'synthetic-token',
      identity: { startedAt: '1999-01-01', executable: identity.executable },
    };
    writeFileSync(file, JSON.stringify(reused));
    assert.equal((await probe()).code, 10);
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(reused));
  } finally {
    if (server.listening) await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
