import { existsSync, readFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { workspaceName } from './workspace.js';
export const journalName = 'restore-journal.json';
// A power loss or failed Windows rename during restore must never create an empty new library.
export function recoverInterruptedRestore(dir) {
  const journal = path.join(dir, journalName);
  if (!existsSync(journal)) return false;
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (!/^previous-[a-f0-9-]+$/.test(state.previous))
    throw new Error('恢复日志无效；请保留 data 并检查安全备份。');
  const old = path.join(dir, state.previous),
    abandoned = path.join(dir, 'interrupted-' + randomUUID());
  mkdirSync(abandoned);
  const oldDb = existsSync(path.join(old, 'library.sqlite'));
  for (const name of [
    'library.sqlite',
    'library.sqlite-wal',
    'library.sqlite-shm',
    'attachments',
    workspaceName,
  ]) {
    const original = path.join(old, name),
      current = path.join(dir, name);
    if (
      existsSync(original) ||
      (oldDb && ['library.sqlite-wal', 'library.sqlite-shm', workspaceName].includes(name))
    ) {
      if (existsSync(current)) renameSync(current, path.join(abandoned, name));
      if (existsSync(original)) renameSync(original, current);
    }
  }
  unlinkSync(journal);
  return true;
}
