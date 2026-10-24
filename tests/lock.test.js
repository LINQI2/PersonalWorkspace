import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireDataLock, inspectProcess } from '../app/server/lock.js';
const self = {
  state: 'alive',
  startedAt: 'current-start',
  executable: 'C:\\node.exe',
  name: 'node.exe',
};
test('lock: graceful restart, duplicate launch, token ownership and real process identity', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-lock-'));
  try {
    assert.equal(inspectProcess(process.pid).state, 'alive');
    const release = acquireDataLock(dir);
    assert.throws(() => acquireDataLock(dir), /已有服务运行/);
    release();
    assert.equal(existsSync(path.join(dir, '.server-lock.json')), false);
    const release2 = acquireDataLock(dir);
    const file = path.join(dir, '.server-lock.json');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(original), token: 'other-owner' }));
    release2();
    assert.equal(existsSync(file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('lock: crash, reboot/PID reuse, legacy LockApp reuse, ambiguous and damaged locks', () => {
  for (const scenario of [
    { owner: { state: 'dead' }, stale: true },
    { owner: { ...self, startedAt: 'reused-after-reboot' }, stale: true },
    {
      legacy: true,
      owner: { ...self, name: 'LockApp.exe', executable: 'C:\\Windows\\LockApp.exe' },
      stale: true,
    },
    { legacy: true, owner: self, stale: false },
    { legacy: true, owner: { state: 'alive', name: 'LockApp.exe' }, stale: true },
    { owner: { state: 'alive', name: 'node.exe' }, stale: false },
    { owner: self, stale: false },
    { owner: { state: 'unknown' }, stale: false },
    { corrupt: true, owner: self, stale: false },
    { patch: { version: 99 }, owner: { state: 'dead' }, stale: false },
    { patch: { identity: null }, owner: { state: 'dead' }, stale: false },
    { guard: true, owner: self, stale: false },
  ]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-lock-case-'));
    try {
      const file = path.join(dir, '.server-lock.json');
      const bytes = scenario.corrupt
        ? '{broken'
        : JSON.stringify({
            pid: 14608,
            token: 'old',
            ...(scenario.legacy ? {} : { version: 2, identity: self }),
            ...scenario.patch,
          });
      writeFileSync(file, bytes);
      writeFileSync(path.join(dir, 'library.sqlite'), 'untouched-database-sentinel');
      if (scenario.guard)
        writeFileSync(path.join(dir, '.server-lock-acquire.json'), 'preserve-unknown-startup');
      const acquire = () =>
        acquireDataLock(dir, { inspect: (pid) => (pid === process.pid ? self : scenario.owner) });
      if (scenario.stale) {
        const release = acquire();
        assert.equal(JSON.parse(readFileSync(file)).version, 2);
        const archive = readdirSync(dir).find((n) => n.startsWith('.server-lock-stale-'));
        assert.equal(readFileSync(path.join(dir, archive), 'utf8'), bytes);
        assert.throws(acquire, /已有服务运行/);
        release();
      } else {
        assert.throws(acquire);
        assert.equal(readFileSync(file, 'utf8'), bytes);
      }
      assert.equal(
        readFileSync(path.join(dir, 'library.sqlite'), 'utf8'),
        'untouched-database-sentinel',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
