import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';

const HEADERS = { 'X-PK-Request': '1', 'Content-Type': 'application/json' };

async function startApp(directory) {
  const store = createApp(directory);
  const server = store.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (url, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + '/api' + url, {
      method,
      headers: {
        'X-PK-Request': '1',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
      response,
    };
  };
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  };
  return { store, base, request, stop };
}

test('任务台整合：安全边界、增删改、层级、撤销与持久化', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pw-tasks-'));
  let app = await startApp(directory);
  t.after(async () => {
    await app.stop().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  });
  const { request } = app;

  const noHeader = await fetch(app.base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(noHeader.status, 403);
  const badOrigin = await fetch(app.base + '/api/tasks', {
    method: 'POST',
    headers: { ...HEADERS, Origin: 'http://evil.example' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(badOrigin.status, 403);
  const badStatus = await request('/tasks', 'POST', { title: 'x', status: 'unknown' });
  assert.equal(badStatus.status, 400);

  const root = (await request('/tasks', 'POST', { title: '根任务' })).data.task;
  const child = (await request('/tasks', 'POST', { title: '子任务', parentId: root.id })).data.task;
  const grand = (await request('/tasks', 'POST', { title: '孙任务', parentId: child.id })).data
    .task;
  assert.equal((await request('/tasks')).data.tasks.length, 3);

  const cycle = await request(`/tasks/${root.id}/move`, 'POST', { parentId: grand.id, index: 0 });
  assert.equal(cycle.status, 400);
  assert.equal(cycle.data.code, 'cycle');
  const self = await request(`/tasks/${root.id}/move`, 'POST', { parentId: root.id, index: 0 });
  assert.equal(self.status, 400);

  const updated = await request(`/tasks/${child.id}`, 'PATCH', {
    title: '子任务改名',
    status: 'doing',
    note: '备注内容',
    collapsed: true,
  });
  assert.equal(updated.data.task.title, '子任务改名');
  assert.equal(updated.data.task.status, 'doing');
  assert.equal(updated.data.task.note, '备注内容');
  assert.equal(updated.data.task.collapsed, true);
  const emptyTitle = await request(`/tasks/${child.id}`, 'PATCH', { title: '   ' });
  assert.equal(emptyTitle.status, 400);
  const badStatusPatch = await request(`/tasks/${child.id}`, 'PATCH', { status: 'bogus' });
  assert.equal(badStatusPatch.status, 400);

  const before = (await request('/tasks')).data.tasks;
  const removed = await request(`/tasks/${child.id}`, 'DELETE');
  assert.equal(removed.data.deletedCount, 2);
  assert.equal((await request('/tasks')).data.tasks.length, 1);
  const undo = await request('/tasks', 'PUT', { tasks: before });
  assert.equal(undo.status, 200);
  assert.equal(undo.data.tasks.length, 3);
  assert.equal(undo.data.tasks.find((x) => x.id === grand.id).parentId, child.id);

  const info = await request('/tasks/info');
  assert.equal(info.data.stats.total, 3);
  assert.equal(info.data.integrity.ok, true);

  // 重启后数据仍在
  await app.stop();
  app = await startApp(directory);
  const restarted = await app.request('/tasks');
  assert.equal(restarted.data.tasks.length, 3);
  assert.equal(restarted.data.tasks.find((x) => x.id === child.id).note, '备注内容');
});

test('任务 JSON 导入严格校验，不静默丢弃或改写', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pw-task-import-'));
  const app = await startApp(directory);
  t.after(async () => {
    await app.stop().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  });
  const { request } = app;

  const invalidStatus = await request('/tasks', 'PUT', {
    tasks: [{ id: 'a', parentId: null, title: '任务', status: 'weird', order: 0 }],
  });
  assert.equal(invalidStatus.status, 400);
  assert.match(invalidStatus.data.error, /状态/);

  const orphan = await request('/tasks', 'PUT', {
    tasks: [{ id: 'a', parentId: 'missing', title: '任务', status: 'todo', order: 0 }],
  });
  assert.equal(orphan.status, 400);

  const longNote = await request('/tasks', 'PUT', {
    tasks: [
      { id: 'a', parentId: null, title: '任务', status: 'todo', order: 0, note: 'x'.repeat(20001) },
    ],
  });
  assert.equal(longNote.status, 400);

  const valid = await request('/tasks', 'PUT', {
    tasks: [
      {
        id: 'root',
        parentId: null,
        title: '迁移根',
        note: 'note',
        status: 'done',
        collapsed: true,
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'child',
        parentId: 'root',
        title: '迁移子',
        note: '',
        status: 'doing',
        collapsed: false,
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.tasks.length, 2);
  assert.ok(existsSync(path.join(directory, 'tasks.db')));
  const snapshot = (await request('/tasks', 'PUT', { tasks: valid.data.tasks })).data.tasks;
  assert.equal(snapshot.find((x) => x.id === 'root').status, 'done');
});

test('统一工作空间备份、恢复与失败回滚', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pw-workspace-'));
  const app = await startApp(directory);
  t.after(async () => {
    await app.stop().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  });
  const { request } = app;

  await request('/taxonomy/domains', 'POST', { name: '工作领域' });
  const root = (await request('/tasks', 'POST', { title: '备份根任务' })).data.task;
  await request('/tasks', 'POST', { title: '备份子任务', parentId: root.id, note: '保留备注' });

  const backupResponse = await fetch(app.base + '/api/workspace/backup', {
    method: 'POST',
    headers: { 'X-PK-Request': '1' },
  });
  assert.equal(backupResponse.status, 200);
  const bytes = Buffer.from(await backupResponse.arrayBuffer());
  assert.ok(bytes.length > 500);

  await request('/tasks', 'POST', { title: '备份之后新增' });
  assert.equal((await request('/tasks')).data.tasks.length, 3);

  const inspectForm = new FormData();
  inspectForm.append('backup', new Blob([bytes], { type: 'application/zip' }), 'w.zip');
  const inspected = await request('/workspace/restore/inspect', 'POST', inspectForm);
  assert.equal(inspected.status, 200);
  assert.equal(inspected.data.type, 'workspace');
  assert.equal(inspected.data.tasks.count, 2);
  assert.equal(inspected.data.knowledge.count, 0);

  const restoreForm = new FormData();
  restoreForm.append('backup', new Blob([bytes], { type: 'application/zip' }), 'w.zip');
  restoreForm.append('confirm', '恢复工作空间');
  const restored = await request('/workspace/restore', 'POST', restoreForm);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.tasks.total, 2);
  const tasksAfter = (await request('/tasks')).data.tasks;
  assert.equal(tasksAfter.length, 2);
  assert.equal(tasksAfter.find((x) => x.title === '备份子任务').note, '保留备注');
  const meta = (await request('/meta')).data;
  assert.equal(meta.domains.length, 1);
  assert.ok(existsSync(path.join(directory, 'backups')));
  assert.ok(
    readdirSync(path.join(directory, 'backups')).some((n) =>
      n.startsWith('before-restore-workspace-'),
    ),
  );
  assert.ok(readdirSync(directory).some((n) => n.startsWith('previous-workspace-')));

  // 损坏 ZIP 不得改变数据
  const badForm = new FormData();
  badForm.append(
    'backup',
    new Blob([Buffer.from('broken')], { type: 'application/zip' }),
    'bad.zip',
  );
  badForm.append('confirm', '恢复工作空间');
  const bad = await request('/workspace/restore', 'POST', badForm);
  assert.equal(bad.status, 400);
  assert.equal((await request('/tasks')).data.tasks.length, 2);

  // 旧任务 JSON 只替换任务，知识库不动
  const legacyImport = await request('/workspace/tasks/import', 'POST', {
    confirm: '导入任务备份',
    payload: {
      app: 'PersonalTaskHub',
      formatVersion: 1,
      tasks: [
        {
          id: 'legacy-1',
          parentId: null,
          title: '旧任务台任务',
          note: '',
          status: 'todo',
          collapsed: false,
          order: 0,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    },
  });
  assert.equal(legacyImport.status, 200);
  assert.equal(legacyImport.data.count, 1);
  assert.equal((await request('/tasks')).data.tasks.length, 1);
  const metaAfterImport = (await request('/meta')).data;
  assert.equal(metaAfterImport.domains.length, 1);
  assert.ok(existsSync(legacyImport.data.snapshot));
});
