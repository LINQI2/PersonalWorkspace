import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server/index.js';
import { quickDraft, saveQuickDraft } from '../app/server/quick-draft.js';
import { exportBackup, validateBackup } from '../app/server/backup.js';
import { readWorkspace, writeWorkspace } from '../app/server/workspace.js';
test('quick draft CAS preserves literal text and original editor drafts, refuses stale writes/deletes and roundtrips genuine ZIP', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-quick-')),
    s = createApp(dir, { ai: { env: {} } });
  try {
    const w = readWorkspace(dir);
    w.drafts.new = {
      form: {
        type: 'note',
        title: '已有编辑草稿',
        url: '',
        description: '',
        content: '<p>旧输入</p>',
        cover_asset_id: null,
        domains: [],
        tags: [],
        collections: [],
        pinned: 0,
      },
      savedAt: '',
      baseUpdatedAt: '',
    };
    writeWorkspace(dir, w);
    const input = {
      text: '第一行\n<script>不会执行</script> & "引文"\n末行',
      title: '临时灵感',
      domain: '',
      tag: '',
      revision: '',
    };
    const a = saveQuickDraft(s.getDb(), dir, input);
    assert.equal(a.text, input.text);
    assert.equal(s.getDb().prepare('SELECT count(*) n FROM entries').get().n, 0);
    assert.throws(() => saveQuickDraft(s.getDb(), dir, input), /其他窗口/);
    assert.throws(() => saveQuickDraft(s.getDb(), dir, { revision: '' }, true), /其他窗口/);
    assert.equal(quickDraft(dir).text, input.text);
    const zip = validateBackup(await exportBackup(s.getDb(), dir), { upgrade: false });
    try {
      assert.equal(quickDraft(zip.tmp).text, input.text);
      assert.equal(readWorkspace(zip.tmp).drafts.new.form.title, '已有编辑草稿');
    } finally {
      zip.dispose();
    }
    assert.throws(
      () => saveQuickDraft(s.getDb(), dir, { ...input, revision: a.revision, domain: 'missing' }),
      /分类/,
    );
    saveQuickDraft(s.getDb(), dir, { revision: a.revision }, true);
    assert.equal(quickDraft(dir).text, '');
    assert.equal(readWorkspace(dir).drafts.new.form.title, '已有编辑草稿');
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('quick draft endpoints require same-origin session and generic draft writes cannot bypass version validation', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-quick-api-')),
    s = createApp(dir, { ai: { env: {} } }),
    server = s.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const session = await (
        await fetch(base + '/api/local/session', { headers: { 'X-PK-Request': '1' } })
      ).json(),
      body = JSON.stringify({ text: '虚构测试输入', title: '', domain: '', tag: '', revision: '' }),
      headers = {
        'Content-Type': 'application/json',
        'X-PK-Request': '1',
        Origin: base,
        'X-PK-Session': session.token,
      };
    assert.equal(
      (
        await fetch(base + '/api/quick-draft', {
          method: 'PUT',
          headers: { ...headers, Origin: 'https://example.com' },
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + '/api/quick-draft', {
          method: 'PUT',
          headers: { ...headers, 'X-PK-Session': '' },
          body,
        })
      ).status,
      403,
    );
    const saved = await fetch(base + '/api/quick-draft', { method: 'PUT', headers, body });
    assert.equal(saved.status, 200);
    assert.equal(
      (await fetch(base + '/api/drafts/quick', { method: 'DELETE', headers })).status,
      400,
    );
    assert.equal(quickDraft(dir).text, '虚构测试输入');
    const bytes = await exportBackup(s.getDb(), dir);
    saveQuickDraft(s.getDb(), dir, { revision: quickDraft(dir).revision }, true);
    assert.equal(quickDraft(dir).text, '');
    const form = new FormData();
    form.append('backup', new Blob([bytes]), 'quick-draft.zip');
    form.append('confirm', '恢复当前知识库');
    const restored = await fetch(base + '/api/restore', {
      method: 'POST',
      headers: { 'X-PK-Request': '1', Origin: base },
      body: form,
    });
    assert.equal(restored.status, 200);
    assert.equal(quickDraft(dir).text, '虚构测试输入');
  } finally {
    await new Promise((r) => server.close(r));
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
