import {
  openSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  closeSync,
  renameSync,
  readlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
// Process creation time distinguishes a reused PID from the original owner.
export function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: 'unknown' };
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') return { state: 'dead' };
    // Windows may deny a signal probe while CIM still exposes a reliable process name.
    if (process.platform !== 'win32') return { state: 'unknown' };
  }
  try {
    if (process.platform === 'win32') {
      const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { 'null' } else { @{startedAt=$p.CreationDate.ToUniversalTime().ToString('o'); executable=$p.ExecutablePath; name=$p.Name} | ConvertTo-Json -Compress }`;
      const p = JSON.parse(
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        }),
      );
      if (!p) return { state: 'dead' };
      if (!p.name) return { state: 'unknown' };
      return { state: 'alive', ...p };
    }
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const executable = readlinkSync(`/proc/${pid}/exe`);
    return {
      state: 'alive',
      startedAt:
        readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() +
        ':' +
        stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
      executable,
      name: path.basename(executable),
    };
  } catch {
    return { state: 'unknown' };
  }
}
const same = (a, b) =>
  a.startedAt === b.startedAt && a.executable.toLowerCase() === b.executable.toLowerCase();
export function acquireDataLock(dir, { inspect = inspectProcess } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.server-lock.json');
  // All launches serialize inspection/recovery/create. A crash in this short
  // critical section requires conservative manual inspection, not blind deletion.
  const guard = path.join(dir, '.server-lock-acquire.json');
  const self = inspect(process.pid);
  if (self.state !== 'alive' || !self.startedAt || !self.executable)
    throw Error('无法确认当前进程身份，已停止启动以保护数据。请检查系统进程查询权限。');
  const token = randomUUID();
  let guardFd;
  try {
    guardFd = openSync(guard, 'wx');
  } catch {
    throw Error(
      '另一个启动正在检查数据锁，或上次启动检查异常中断。请稍后重试；若持续出现，请确认服务状态并保留检查 .server-lock-acquire.json，勿直接删除有效锁。',
    );
  }
  try {
    writeFileSync(guardFd, JSON.stringify({ pid: process.pid, token, identity: self }));
    if (existsSync(file)) {
      let lock;
      try {
        lock = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Error(
          '数据目录锁文件损坏，请先确认没有服务运行，保留数据并检查 .server-lock.json。',
        );
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1 || typeof lock.token !== 'string')
        throw new Error('数据目录锁无效，请检查 .server-lock.json。');
      if (lock.version !== undefined && lock.version !== 2)
        throw Error('未知锁版本，无法安全确认。请保留并检查 .server-lock.json。');
      if (
        lock.version === 2 &&
        (typeof lock.identity?.startedAt !== 'string' ||
          !lock.identity.startedAt ||
          typeof lock.identity.executable !== 'string' ||
          !lock.identity.executable)
      )
        throw Error('进程身份锁损坏，无法安全确认。请保留并检查 .server-lock.json。');
      const owner = inspect(lock.pid);
      let stale = owner.state === 'dead';
      if (owner.state === 'alive') {
        if (lock.version === 2) {
          if (!owner.startedAt || !owner.executable)
            throw Error('无法读取锁所属进程的完整身份，已停止启动。请检查系统权限并保留有效锁。');
          stale = !same(lock.identity, owner);
        } else if (lock.version === undefined) {
          // Legacy Node locks have no start identity and remain ambiguous.
          stale = !!owner.name && !/^node(?:\.exe)?$/i.test(owner.name);
        } else throw Error('未知锁版本，无法安全确认。请保留并检查 .server-lock.json。');
        if (!stale)
          throw Error(
            '此数据目录已有服务运行，或旧锁对应的 Node 进程身份无法安全确认。请关闭原启动窗口后重开；不要强制删除锁。',
          );
      }
      if (!stale)
        throw Error(
          '无法安全确认数据锁所属进程（可能权限不足）。已停止启动，请保留锁并检查运行服务。',
        );
      renameSync(file, path.join(dir, `.server-lock-stale-${Date.now()}-${randomUUID()}.json`));
    }
    const fd = openSync(file, 'wx');
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          version: 2,
          pid: process.pid,
          token,
          identity: { startedAt: self.startedAt, executable: self.executable },
        }),
      );
    } finally {
      closeSync(fd);
    }
  } finally {
    closeSync(guardFd);
    unlinkSync(guard);
  }
  return () => {
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).token === token) unlinkSync(file);
    } catch {
      /* Preserve replaced, damaged or inaccessible locks. */
    }
  };
}
