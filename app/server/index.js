import { spaceSql } from './space.js';
import { createProfessionalImport } from './professional-import.js';
import { seedPreview, seedSamples } from './professional-seed.js';
import { professionalDomains, saveProfessionalDomain, searchProfessional, readProfessional, saveProfessional } from './professional.js';
import { getMap, saveMap, importMap } from './mindmaps.js';
import { visibleSql, quickCapture, setLifecycle } from './lifecycle.js';
import express from 'express';
import {
  related,
  graph,
  candidates,
  writeRelation,
  reviewRelation,
  changeRelations,
  restoreRelations,
  checkDelete,
  relationVersion,
} from './relations.js';
import { createRelationReview } from './ai/relations.js';
import {
  domainTree,
  domainScope,
  saveDomain,
  deleteDomain,
  setRule,
  ruleMembers,
  provenance,
  validateFilters,
  cleanupCandidates,
} from './unified.js';
import { exchangeSchemaV2 } from './knowledge/exchange.js';
import { acquireDataLock } from './lock.js';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import { openStore, kinds, hydrate, saveEntry, VERSION } from './store.js';
import { createMark, updateMark, readingMarks, readingTargets, markDetail } from './reading.js';
import { createPasteSession } from './paste.js';
import { quickDraft, saveQuickDraft } from './quick-draft.js';
import {
  getCollection,
  saveCollection,
  collectionRelations,
  readCollectionDraft,
  writeCollectionDraft,
  saveManualCollectionDraft,
  updateAiReview,
  validateLiveSources,
} from './topics.js';
import { exportBackup, validateBackup } from './backup.js';
import { recoverInterruptedRestore, journalName } from './recovery.js';
import { createTaskStore, analyzeTasks } from './tasks/store.js';
import { createTaskRouter } from './tasks/router.js';
import {
  buildWorkspaceBackup,
  classifyBackup,
  inspectWorkspaceBackup,
} from './workspace-backup.js';
import { recoverWorkspaceRestore, restoreWorkspaceBackup } from './workspace-restore.js';
import {
  readWorkspace,
  writeWorkspace,
  workspaceName,
  defaultWorkspace,
  validateWorkspace,
} from './workspace.js';
import { findDuplicate, recentTaxonomy, batchEntries } from './library.js';
import { createAiService } from './ai/service.js';
import { AiError } from './ai/provider.js';
import {
  directories,
  saveDirectory,
  getRecord,
  saveRecord,
  listRecords,
  moveRecord,
  moveDirectory,
  saveKnowledgeDraft,
  transaction,
} from './knowledge/store.js';
import { attach, chapterRows, structuralSuggestions } from './knowledge/structure.js';
import { createIntegration } from './knowledge/integration.js';
import { createAssistantReview } from './assistant/review.js';
import { inspect, retrieve, scope } from './assistant/catalog.js';
import { createImportSession } from './knowledge/importer.js';
import { exchangeSchema } from './knowledge/exchange.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function createApp(dataDir = path.join(root, 'data'), options = {}) {
  const dir = path.resolve(dataDir);
  mkdirSync(dir, { recursive: true });
  recoverWorkspaceRestore(dir);
  recoverInterruptedRestore(dir);
  readWorkspace(dir);
  const open = () =>
    openStore(dir, {
      validateMigrationBackup: (bytes) => {
        const checked = validateBackup(bytes, { upgrade: false });
        checked.dispose();
      },
    });
  let db = open();
  try {
    readWorkspace(dir);
  } catch (e) {
    db.close();
    throw e;
  }
  const openTasks = () => createTaskStore({ dbFile: path.join(dir, 'tasks.db') });
  let tasks;
  try {
    tasks = openTasks();
  } catch (e) {
    db.close();
    throw e;
  }
  let busy = false,
    uploads = 0;
  const app = express();
  const sessionToken = randomUUID();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return res.status(403).json({ error: '仅允许本地访问。' });
    const hostPort = host.includes(':') ? Number(host.split(':')[1]) : 80;
    if (
      hostPort !== req.socket.localPort ||
      !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: '仅允许本机同源访问。' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`)
      return res.status(403).json({ error: '访问来源不被允许。请从本地网站操作。' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-pk-request'] !== '1')
      return res.status(403).json({ error: '缺少本地请求标记。' });
    if (busy && (req.path.startsWith('/api') || req.path.startsWith('/assets')))
      return res.status(503).json({ error: '正在备份或恢复，请稍后重试。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  const maintenance = (req, res, next) =>
    busy ? res.status(503).json({ error: '正在备份或恢复，请稍后重试。' }) : next();
  app.use('/api', maintenance);
  app.use(
    '/api/tasks',
    createTaskRouter(() => tasks),
  );
  const ai = createAiService(dir, () => db, options.ai);
  const credentialGuard = (req, res, next) =>
    req.headers.origin === `http://${req.headers.host}` &&
    req.headers['x-pk-session'] === sessionToken &&
    req.is('application/json')
      ? next()
      : res.status(403).json({ error: '请从当前本地网站确认操作。' });
  app.get('/api/professional/seed/preview', (req,res)=>res.json(seedPreview(db,req.query.batch||'samples')));
  const professionalImports=createProfessionalImport(()=>db);
  app.post('/api/professional/import/preview',credentialGuard,(req,res)=>res.json(professionalImports.preview(req.body.raw)));
  app.post('/api/professional/import/commit',credentialGuard,(req,res)=>res.json(professionalImports.commit(req.body)));
  app.post('/api/professional/import/cancel',credentialGuard,(req,res)=>res.json(professionalImports.cancel(req.body.token)));
  app.get('/api/professional/versions/:id',(req,res)=>{
    readProfessional(db,req.params.id);
    res.json(db.prepare('SELECT * FROM knowledge_versions WHERE entry_id=? ORDER BY revision DESC LIMIT 50').all(req.params.id));
  });
  app.post('/api/professional/seed',credentialGuard,(req,res)=>res.json(seedSamples(db,req.body)));
  app.get('/api/professional/domains', (_req,res)=>res.json(professionalDomains(db)));
  app.get('/api/professional/search', (req,res)=>res.json(searchProfessional(db,req.query)));
  app.get('/api/professional/read/:id', (req,res)=>res.json(readProfessional(db,req.params.id)));
  app.get('/api/professional/related/:id', (req,res)=>{
    const card=readProfessional(db,req.params.id);
    res.json(card.relations.map(r=>({...r,from_space:db.prepare('SELECT 1 FROM professional_entries WHERE entry_id=?').get(r.from_id)?'professional':'personal',to_space:db.prepare('SELECT 1 FROM professional_entries WHERE entry_id=?').get(r.to_id)?'professional':'personal'})));
  });
  app.post('/api/professional/domains',credentialGuard,(req,res)=>res.json(saveProfessionalDomain(db,req.body)));
  app.put('/api/professional/domains/:id',credentialGuard,(req,res)=>res.json(saveProfessionalDomain(db,req.body,req.params.id)));
  app.delete('/api/professional/domains/:id',credentialGuard,(req,res)=>{
    if(req.body.confirm!=='删除专业领域') throw Error('请明确确认删除领域。');
    db.prepare('DELETE FROM professional_domains WHERE id=?').run(req.params.id);res.json({ok:true});
  });
  app.post('/api/professional/entries',credentialGuard,(req,res)=>res.json(saveProfessional(db,req.body)));
  app.put('/api/professional/entries/:id',credentialGuard,(req,res)=>res.json(saveProfessional(db,req.body,req.params.id)));
  app.get('/api/mindmaps/:id', (req, res) => res.json(getMap(db, req.params.id)));
  app.post('/api/mindmaps', credentialGuard, (req, res) => res.json(saveMap(db, req.body)));
  app.put('/api/mindmaps/:id', credentialGuard, (req, res) =>
    res.json(saveMap(db, req.body, req.params.id)),
  );
  app.post('/api/mindmap-import/preview', credentialGuard, (req, res) =>
    res.json(importMap(req.body)),
  );
  app.get('/api/mindmaps/:id/versions', (req, res) =>
    res.json(
      db
        .prepare('SELECT * FROM mindmap_versions WHERE entry_id=? ORDER BY revision DESC LIMIT 50')
        .all(req.params.id),
    ),
  );
  app.get('/api/library/domains', (_req, res) => res.json(domainTree(db)));
  app.get('/api/library/schema', (_req, res) => res.json(exchangeSchemaV2));
  app.get('/api/library/template', (_req, res) =>
    res.json(
      JSON.parse(readFileSync(path.join(root, 'docs/examples/content-v2-success.json'), 'utf8')),
    ),
  );
  app.get('/api/library/cleanup-candidates', (_req, res) => res.json(cleanupCandidates(db)));
  app.get('/api/library/provenance/:id', (_req, res) => res.json(provenance(db, _req.params.id)));
  app.get('/api/library/views', (_req, res) =>
    res.json(
      db
        .prepare('SELECT * FROM library_views ORDER BY position,id')
        .all()
        .map((r) => ({ ...r, filters: JSON.parse(r.filters_json) })),
    ),
  );
  app.post('/api/library/views', credentialGuard, (req, res) => {
    const name = req.body.name?.trim();
    if (!name || name.length > 50) throw Error('快捷视图名称必填，最多50字。');
    const filters = validateFilters(db, req.body.filters);
    const id = randomUUID();
    if (db.prepare('SELECT count(*) n FROM library_views').get().n >= 20)
      throw Error('最多固定20个视图。');
    db.prepare('INSERT INTO library_views VALUES(?,?,?,?)').run(
      id,
      name,
      JSON.stringify(filters),
      Date.now(),
    );
    res.json({ id });
  });
  app.delete('/api/library/views/:id', credentialGuard, (req, res) => {
    db.prepare('DELETE FROM library_views WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/library/collections/:id/rules', (req, res) => {
    const r = db.prepare('SELECT * FROM collection_rules WHERE collection_id=?').get(req.params.id);
    res.json({
      rules: r ? JSON.parse(r.rules_json) : null,
      ids: ruleMembers(db, req.params.id),
      manual: db
        .prepare('SELECT entry_id FROM entry_collections WHERE taxonomy_id=?')
        .all(req.params.id)
        .map((r) => r.entry_id),
    });
  });
  app.post('/api/library/collections/:id/rules/preview', credentialGuard, (req, res) =>
    res.json({ ids: ruleMembers(db, req.params.id, validateFilters(db, req.body.rules)) }),
  );
  app.put('/api/library/collections/:id/rules', credentialGuard, (req, res) =>
    res.json(setRule(db, req.params.id, req.body)),
  );
  const relationReview = createRelationReview(() => db, ai, options.relations);
  app.get('/api/relation-candidates', (req, res) => res.json(candidates(db, req.query)));
  app.get('/api/relations/:id', (req, res) => res.json(related(db, req.params.id)));
  app.post('/api/relations/graph', credentialGuard, (req, res) => res.json(graph(db, req.body)));
  app.post('/api/relations/save', credentialGuard, (req, res) => {
    if (req.body.confirm !== '保存人工关联') throw Error('请明确保存人工关联。');
    res.json(changeRelations(db, () => writeRelation(db, req.body)));
  });
  app.post('/api/relations/review', credentialGuard, (req, res) =>
    res.json(reviewRelation(db, req.body)),
  );
  app.get('/api/relation-history', (_req, res) =>
    res.json(
      db
        .prepare('SELECT id,created_at FROM relation_history ORDER BY created_at DESC LIMIT 30')
        .all(),
    ),
  );
  app.post('/api/relations/restore', credentialGuard, (req, res) => {
    if (req.body.confirm !== '恢复关联历史') throw Error('请确认恢复。');
    res.json(restoreRelations(db, req.body.id));
  });
  app.post('/api/relations/estimate', credentialGuard, (req, res) =>
    res.json(relationReview.estimate(req.body)),
  );
  app.post('/api/relations/generate', credentialGuard, async (req, res, next) => {
    const c = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) c.abort();
    });
    try {
      res.json(await relationReview.generate(req.body, c.signal));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/relations/apply', credentialGuard, (req, res) =>
    res.json(relationReview.apply(req.body)),
  );
  app.post('/api/relations/cancel', credentialGuard, (req, res) =>
    res.json(relationReview.cancel(req.body.token)),
  );
  const imports = createImportSession(() => db, options.knowledge);
  const paste = createPasteSession(() => db, options.knowledge);
  app.post('/api/knowledge/paste/check', credentialGuard, (req, res) =>
    res.json(paste.check(req.body)),
  );
  app.post('/api/knowledge/paste/preview', credentialGuard, (req, res) =>
    res.json(paste.preview(req.body)),
  );
  app.post('/api/knowledge/paste/commit', credentialGuard, (req, res) =>
    res.json(paste.commit(req.body)),
  );
  app.post('/api/knowledge/paste/cancel', credentialGuard, (req, res) =>
    res.json(paste.cancel(req.body.token)),
  );
  const integration = createIntegration(() => db, ai);
  const assistant = createAssistantReview(() => db, ai, dir, options.assistant);
  app.get('/api/assistant/catalog', (_req, res) => res.json(inspect(db)));
  app.post('/api/assistant/search', credentialGuard, (req, res) =>
    res.json(retrieve(db, req.body.question, req.body.space)),
  );
  app.post('/api/assistant/scope', credentialGuard, (req, res) => res.json(scope(db, req.body)));
  app.post('/api/assistant/estimate', credentialGuard, (req, res) =>
    res.json(assistant.estimate(req.body)),
  );
  app.post('/api/assistant/generate', credentialGuard, async (req, res, next) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      res.json(await assistant.generate(req.body, controller.signal));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/assistant/preview', credentialGuard, (req, res) =>
    res.json(assistant.preview(req.body)),
  );
  app.post('/api/assistant/apply', credentialGuard, (req, res) =>
    res.json(assistant.apply(req.body)),
  );
  app.post('/api/assistant/cancel', credentialGuard, (req, res) =>
    res.json(assistant.cancel(req.body)),
  );
  app.get('/api/assistant/history', (_req, res) => res.json(assistant.history()));
  app.post('/api/assistant/restore', credentialGuard, (req, res) =>
    res.json(assistant.restore(req.body)),
  );
  app.post('/api/knowledge/integration/estimate', credentialGuard, (req, res) =>
    res.json(integration.estimate(req.body)),
  );
  app.post('/api/knowledge/integration/generate', credentialGuard, async (req, res, next) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      res.json(await integration.generate(req.body, controller.signal));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/knowledge/integration/apply', credentialGuard, (req, res) =>
    res.json(integration.apply(req.body)),
  );
  app.post('/api/knowledge/integration/cancel', credentialGuard, (req, res) =>
    res.json(integration.cancel(req.body)),
  );
  app.get('/api/knowledge/schema', (_req, res) => res.json(exchangeSchema));
  app.get('/api/knowledge/template', (_req, res) =>
    res.json(
      JSON.parse(readFileSync(path.join(root, 'docs/examples/knowledge-success.json'), 'utf8')),
    ),
  );
  app.get('/api/knowledge/directories', (_req, res) => res.json(directories(db)));
  app.post('/api/knowledge/directories', credentialGuard, (req, res) =>
    res.json(saveDirectory(db, req.body)),
  );
  app.put('/api/knowledge/directories/:id', credentialGuard, (req, res) =>
    res.json(saveDirectory(db, req.body, req.params.id)),
  );
  app.post('/api/knowledge/directories/:id/move', credentialGuard, (req, res) =>
    res.json(moveDirectory(db, req.params.id, req.body.direction)),
  );
  app.delete('/api/knowledge/directories/:id', credentialGuard, (req, res) => {
    if (
      db.prepare('SELECT id FROM knowledge_directories WHERE parent_id=?').get(req.params.id) ||
      db.prepare('SELECT entry_id FROM knowledge_records WHERE directory_id=?').get(req.params.id)
    )
      throw Error('目录非空，请先移动知识与子目录；原资料保留。');
    db.prepare('DELETE FROM knowledge_directories WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/knowledge/records', (req, res) => res.json(listRecords(db, req.query)));
  app.get('/api/knowledge/pages/:id/chapters', (req, res) => {
    if (getRecord(db, req.params.id).kind !== 'page') throw Error('不是混合页面。');
    res.json({
      items: chapterRows(db, req.params.id),
      suggestions: structuralSuggestions(db, req.params.id),
    });
  });
  app.post('/api/knowledge/structure', credentialGuard, (req, res) =>
    res.json(transaction(db, () => attach(db, req.body))),
  );
  app.get('/api/knowledge/versions/:id', (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT * FROM knowledge_versions WHERE entry_id=? ORDER BY created_at DESC LIMIT 50',
        )
        .all(req.params.id),
    ),
  );
  app.get('/api/knowledge/records/:id', (req, res) => res.json(getRecord(db, req.params.id)));
  app.post('/api/knowledge/records', credentialGuard, (req, res) =>
    res.json(saveRecord(db, req.body)),
  );
  app.put('/api/knowledge/records/:id', credentialGuard, (req, res) =>
    res.json(saveRecord(db, req.body, req.params.id)),
  );
  app.post('/api/knowledge/records/:id/move', credentialGuard, (req, res) =>
    res.json(moveRecord(db, req.params.id, req.body.direction)),
  );
  app.post('/api/knowledge/relations/:id/review', credentialGuard, (req, res) =>
    res.json(reviewRelation(db, { ...req.body, id: req.params.id })),
  );
  app.get('/api/knowledge/drafts/:key', (req, res) => {
    const d = db.prepare('SELECT * FROM knowledge_drafts WHERE key=?').get(req.params.key);
    res.json(d ? { form: JSON.parse(d.payload), savedAt: d.saved_at } : null);
  });
  app.put('/api/knowledge/drafts/:key', credentialGuard, (req, res) =>
    res.json(saveKnowledgeDraft(db, req.params.key, req.body)),
  );
  app.delete('/api/knowledge/drafts/:key', credentialGuard, (req, res) => {
    db.prepare('DELETE FROM knowledge_drafts WHERE key=?').run(req.params.key);
    res.json({ ok: true });
  });
  app.post('/api/knowledge/import/preview', credentialGuard, (req, res) =>
    res.json(imports.preview(req.body.raw, req.body.format, req.body.convertLegacy === true)),
  );
  app.post('/api/knowledge/import/commit', credentialGuard, (req, res) =>
    res.json(imports.commit(req.body)),
  );
  app.post('/api/knowledge/import/cancel', credentialGuard, (req, res) =>
    res.json(imports.cancel(req.body.token)),
  );
  app.post('/api/knowledge/import/source', credentialGuard, (req, res) => {
    const batch = db.prepare('SELECT * FROM knowledge_imports WHERE id=?').get(req.body.id);
    if (!batch) throw Error('导入来源不存在。');
    res.json(batch);
  });
  app.get('/api/local/session', (req, res) =>
    req.headers['x-pk-request'] === '1'
      ? res.json({ token: sessionToken })
      : res.status(403).json({ error: '缺少本地请求标记。' }),
  );
  app.get('/api/local/status', (_req, res) =>
    res.json({
      canStop: !!options.onShutdown,
      version: '1.9.0',
      workspaceVersion: '1.0.0',
    }),
  );
  app.get('/api/local/instance', (req, res) =>
    options.instanceToken && req.headers['x-pk-instance'] === options.instanceToken
      ? res.json({
          application: 'PersonalWorkspace',
          projectRoot: root,
          dataPath: dir,
          pid: process.pid,
          workspaceVersion: '1.0.0',
        })
      : res.status(403).json({ error: '无法确认本地实例。' }),
  );
  app.post('/api/local/shutdown', credentialGuard, (req, res) => {
    if (!options.onShutdown || !['停止个人工作空间', '停止知识库'].includes(req.body?.confirm))
      return res.status(400).json({ error: '请明确确认停止当前个人工作空间。' });
    if (busy || uploads)
      return res.status(409).json({ error: '正在备份、恢复或上传，请完成后再停止。' });
    ai.cancel();
    res.json({ ok: true });
    setTimeout(() => options.onShutdown(), 150);
  });
  const safeAiRoute = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      const error = e instanceof AiError ? e : new AiError('secure_storage');
      res
        .status(error.code === 'timeout' ? 504 : error.code === 'busy' ? 409 : 400)
        .json({ code: error.code, error: error.message });
    }
  };
  app.put(
    '/api/ai/config',
    credentialGuard,
    safeAiRoute((req) => ai.update(req.body)),
  );
  app.post(
    '/api/ai/test',
    credentialGuard,
    safeAiRoute(async (req) => {
      if (req.body?.confirm !== '测试连接可能产生费用') throw new AiError('confirmation');
      const controller = new AbortController();
      req.res.once('close', () => {
        if (!req.res.writableEnded) controller.abort(new AiError('cancelled'));
      });
      return ai.testConnection(controller.signal);
    }),
  );
  app.get('/api/ai/status', (_req, res) => res.json(ai.status()));
  app.post('/api/ai/suggest', async (req, res) => {
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort(new AiError('cancelled'));
    };
    res.once('close', cancel);
    try {
      const result = await ai.suggest(req.body, controller.signal);
      if (!controller.signal.aborted) {
        if (busy) throw new AiError('busy');
        if (req.body.mode === 'collection' && result.suggestion.status === 'ready') {
          if (getCollection(db, req.body.collectionId).revision !== result.revision)
            throw new AiError('invalid_output');
          result.draftId = randomUUID();
          try {
            validateLiveSources(db, req.body.collectionId, result.sources);
          } catch {
            const error = new AiError('invalid_output');
            error.message = '所选资料在生成期间已更新/移除，请重新生成；原总结与草稿不变。';
            throw error;
          }
          writeCollectionDraft(
            db,
            req.body.collectionId,
            'ai',
            { id: result.draftId, suggestion: result.suggestion, sources: result.sources },
            result.revision,
          );
        }
        res.json(result);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const error = e instanceof AiError ? e : new AiError('upstream');
        const status =
          error.code === 'busy'
            ? 409
            : error.code === 'rate'
              ? 429
              : error.code === 'not_configured' || error.code === 'config'
                ? 503
                : error.code === 'timeout'
                  ? 504
                  : 400;
        res.status(status).json({ error: error.message, code: error.code });
      }
    } finally {
      res.off('close', cancel);
    }
  });
  app.get('/api/meta', (_req, res) =>
    res.json({
      version: '1.9.0',
      workspaceVersion: '1.0.0',
      recent: recentTaxonomy(db),
      schemaVersion: VERSION,
      dataPath: dir,
      tasks: tasks.stats(),
      stats: {
        total: db.prepare('SELECT count(*) n FROM entries e WHERE '+spaceSql(db)).get().n,
        pending: db
          .prepare(
            'SELECT count(*) n FROM entries e WHERE '+spaceSql(db)+' AND NOT EXISTS(SELECT 1 FROM entry_domains r WHERE r.entry_id=e.id)',
          )
          .get().n,
        notes: db
          .prepare("SELECT count(*) n FROM entries e WHERE type='note' AND resource_kind='knowledge' AND "+spaceSql(db))
          .get().n,
        tools: db.prepare("SELECT count(*) n FROM entries e WHERE resource_kind='tool' AND "+spaceSql(db)).get().n,
        knowledge: db.prepare('SELECT count(*) n FROM knowledge_records k JOIN entries e ON e.id=k.entry_id WHERE '+spaceSql(db)).get().n,
        captures: db.prepare("SELECT count(*) n FROM knowledge_records k JOIN entries e ON e.id=k.entry_id WHERE status='inbox' AND "+spaceSql(db)).get()
          .n,
      },
      ...Object.fromEntries(
        kinds.map((k) => [
          k,
          db
            .prepare(
              `SELECT t.*, (SELECT count(*) FROM entry_${k} WHERE taxonomy_id=t.id) count FROM ${k} t ORDER BY name`,
            )
            .all(),
        ]),
      ),
    }),
  );
  app.post('/api/capture', credentialGuard, (req, res) => res.json(quickCapture(db, req.body)));
  app.post('/api/content/:id/action', credentialGuard, (req, res) =>
    res.json(setLifecycle(db, req.params.id, req.body)),
  );
  app.get('/api/entries', (req, res) => {
    const q = req.query;
    const where = [spaceSql(db),
        q.view === 'trash'
          ? "EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id AND l.state='trash')"
          : visibleSql(db),
      ],
      params = [];
    if (q.q) {
      where.push(
        "(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR plain_text LIKE ? ESCAPE '\\')",
      );
      const keyword =
        '%' +
        String(q.q)
          .slice(0, 200)
          .replace(/[\\%_]/g, '\\$&') +
        '%';
      params.push(keyword, keyword, keyword);
    }
    if (q.library === '1') {
      if (q.view === 'inbox')
        where.push(
          "(EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id AND l.state IN ('inbox','later')) OR (NOT EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id) AND (EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.status='inbox') OR EXISTS(SELECT 1 FROM content_provenance p WHERE p.entry_id=e.id AND p.status='inbox'))))",
        );
      if (q.saved_view) {
        const rule = validateFilters(db, JSON.parse(String(q.saved_view)));
        for (const k of ['domains', 'tags'])
          if (rule[k].length) {
            const ids =
              k === 'domains' ? [...new Set(rule[k].flatMap((d) => domainScope(db, d)))] : rule[k];
            where.push(
              `EXISTS(SELECT 1 FROM entry_${k} r WHERE r.entry_id=e.id AND taxonomy_id IN (${ids.map(() => '?').join(',')}))`,
            );
            params.push(...ids);
          }
        if (rule.types.length)
          where.push(
            '(' +
              rule.types
                .map((t) =>
                  t === 'mindmap'
                    ? 'EXISTS(SELECT 1 FROM mindmaps m WHERE m.entry_id=e.id)'
                    : t === 'tool'
                      ? "resource_kind='tool'"
                      : t === 'bookmark'
                        ? "type='bookmark' AND resource_kind='knowledge'"
                        : t === 'document'
                          ? "EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.kind='page')"
                          : "type='note' AND resource_kind='knowledge' AND NOT EXISTS(SELECT 1 FROM mindmaps m WHERE m.entry_id=e.id) AND NOT EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.kind='page')",
                )
                .join(' OR ') +
              ')',
          );
      }

      if (!q.q && q.view !== 'trash')
        where.push('NOT EXISTS(SELECT 1 FROM knowledge_structure s WHERE s.entry_id=e.id)');
      if (q.content_type === 'mindmap')
        where.push('EXISTS(SELECT 1 FROM mindmaps m WHERE m.entry_id=e.id)');
      if (q.content_type === 'note')
        where.push(
          "type='note' AND resource_kind='knowledge' AND NOT EXISTS(SELECT 1 FROM mindmaps m WHERE m.entry_id=e.id) AND NOT EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.kind='page')",
        );
      if (q.content_type === 'bookmark')
        where.push("type='bookmark' AND resource_kind='knowledge'");
      if (q.content_type === 'tool') where.push("resource_kind='tool'");
      if (q.content_type === 'document')
        where.push(
          "EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.kind='page')",
        );
    }
    if (q.view === 'pending')
      where.push('NOT EXISTS(SELECT 1 FROM entry_domains r WHERE r.entry_id=e.id)');
    if (q.view === 'notes') where.push("type='note' AND resource_kind='knowledge'");
    if (q.view === 'tools') where.push("resource_kind='tool'");
    if (q.tool_kind) {
      where.push('tool_kind=?');
      params.push(String(q.tool_kind));
    }
    for (const k of kinds)
      if (q[k]) {
        if (q.library === '1' && k === 'domains' && q[k] === '__unassigned__') {
          where.push('NOT EXISTS(SELECT 1 FROM entry_domains r WHERE r.entry_id=e.id)');
        } else if (q.library === '1' && k === 'domains') {
          const ids = domainScope(db, String(q[k]));
          where.push(
            `EXISTS(SELECT 1 FROM entry_domains r WHERE r.entry_id=e.id AND taxonomy_id IN (${ids.map(() => '?').join(',')}))`,
          );
          params.push(...ids);
        } else if (k === 'collections') {
          const dynamic = ruleMembers(db, String(q[k]));
          where.push(
            `(EXISTS(SELECT 1 FROM entry_collections r WHERE r.entry_id=e.id AND taxonomy_id=?)${dynamic.length ? ' OR e.id IN (' + dynamic.map(() => '?').join(',') + ')' : ''})`,
          );
          params.push(String(q[k]), ...dynamic);
        } else {
          where.push(`EXISTS(SELECT 1 FROM entry_${k} r WHERE r.entry_id=e.id AND taxonomy_id=?)`);
          params.push(String(q[k]));
        }
      }
    if (q.source) {
      where.push(
        'EXISTS(SELECT 1 FROM knowledge_entry_sources r JOIN knowledge_sources s ON s.id=r.source_id WHERE r.entry_id=e.id AND s.kind=?) OR EXISTS(SELECT 1 FROM content_source_links r JOIN knowledge_sources s ON s.id=r.source_id WHERE r.entry_id=e.id AND s.kind=?)',
      );
      params.push(String(q.source), String(q.source));
      where[where.length - 1] = '(' + where.at(-1) + ')';
    }
    if (q.status && !['inbox', 'later', 'done'].includes(String(q.status))) {
      where.push(
        '(EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.status=?) OR EXISTS(SELECT 1 FROM content_provenance p WHERE p.entry_id=e.id AND p.status=?))',
      );
      params.push(String(q.status), String(q.status));
    } else if (q.status) {
      where.push(
        '(EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id AND l.state=?) OR (NOT EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=e.id) AND (EXISTS(SELECT 1 FROM knowledge_records k WHERE k.entry_id=e.id AND k.status=?) OR EXISTS(SELECT 1 FROM content_provenance p WHERE p.entry_id=e.id AND p.status=?))))',
      );
      params.push(String(q.status), String(q.status), String(q.status));
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = db.prepare('SELECT count(*) n FROM entries e' + clause).get(...params).n;
    const page = Math.max(1, Math.min(100000, Number(q.page) || 1));
    const size = 24;
    const order =
      q.sort === 'title'
        ? 'title COLLATE NOCASE ASC,id ASC'
        : q.sort === 'oldest'
          ? 'created_at ASC,id ASC'
          : q.sort === 'updated'
            ? 'updated_at DESC, id DESC'
            : q.sort === 'pinned'
              ? 'pinned DESC,created_at DESC,id DESC'
              : 'created_at DESC,id DESC';
    const rows = db
      .prepare(
        'SELECT * FROM entries e' + clause + ' ORDER BY pinned DESC,' + order + ' LIMIT ? OFFSET ?',
      )
      .all(...params, size, (page - 1) * size);
    res.json({ items: rows.map((x) => hydrate(db, x)), total, page, pageSize: size });
  });
  app.get('/api/collections/:id', (req, res) => res.json(getCollection(db, req.params.id)));
  app.put('/api/collections/:id', (req, res) =>
    res.json(saveCollection(db, req.params.id, req.body)),
  );
  app.post('/api/collections/:id/resources', (req, res) =>
    res.json(collectionRelations(db, req.params.id, req.body)),
  );
  app.get('/api/collections/:id/versions', (req, res) => {
    getCollection(db, req.params.id);
    res.json(
      db
        .prepare(
          'SELECT id,title,revision,created_at FROM collection_versions WHERE collection_id=? ORDER BY revision DESC LIMIT 50',
        )
        .all(req.params.id),
    );
  });
  app.get('/api/collections/:id/versions/:version', (req, res) => {
    const row = db
      .prepare('SELECT * FROM collection_versions WHERE id=? AND collection_id=?')
      .get(req.params.version, req.params.id);
    if (!row) throw Error('专题历史版本不存在。');
    res.json({ ...row, sources: JSON.parse(row.sources_json) });
  });
  app.post('/api/collections/:id/versions/:version/restore', (req, res) => {
    if (req.body.confirm !== '恢复专题版本') throw Error('请明确确认恢复专题版本。');
    const row = db
      .prepare('SELECT * FROM collection_versions WHERE id=? AND collection_id=?')
      .get(req.params.version, req.params.id);
    if (!row) throw Error('专题历史版本不存在。');
    res.json(
      saveCollection(db, req.params.id, {
        name: row.title,
        introduction: row.introduction,
        content: row.content,
        revision: req.body.revision,
        historyVersionId: row.id,
      }),
    );
  });
  app.get('/api/collections/:id/drafts/:kind', (req, res) => {
    if (!['manual', 'ai'].includes(req.params.kind)) throw Error('专题草稿类型无效。');
    res.json(readCollectionDraft(db, req.params.id, req.params.kind));
  });
  app.put('/api/collections/:id/drafts/manual', (req, res) =>
    res.json(saveManualCollectionDraft(db, req.params.id, req.body)),
  );
  app.put('/api/collections/:id/drafts/ai', (req, res) =>
    res.json(updateAiReview(db, req.params.id, req.body)),
  );
  app.delete('/api/collections/:id/drafts/:kind', (req, res) => {
    if (!['manual', 'ai'].includes(req.params.kind)) throw Error('专题草稿类型无效。');
    db.prepare('DELETE FROM collection_drafts WHERE collection_id=? AND kind=?').run(
      req.params.id,
      req.params.kind,
    );
    res.json({ ok: true });
  });
  app.get('/api/preferences', (_req, res) => res.json(readWorkspace(dir).preferences));
  app.put('/api/preferences', (req, res) => {
    const w = readWorkspace(dir);
    w.preferences = { ...w.preferences, ...req.body };
    res.json(writeWorkspace(dir, w).preferences);
  });
  app.get('/api/drafts', (_req, res) => {
    res.json(
      Object.entries(readWorkspace(dir).drafts).map(([key, d]) => ({
        key,
        title: d.form.title || '未命名草稿',
        savedAt: d.savedAt,
        missingEntry:
          !['new', 'new-tool', 'quick'].includes(key) &&
          !db.prepare('SELECT id FROM entries WHERE id=?').get(key),
      })),
    );
  });
  app.get('/api/reading/targets', (req, res) => res.json(readingTargets(db, req.query.q || '')));
  app.get('/api/reading/marks/:id', (req, res) => res.json(readingMarks(db, req.params.id)));
  app.get('/api/reading/mark/:id', (req, res) => {
    const row = db
      .prepare('SELECT * FROM reading_marks WHERE id=? AND deleted_at IS NULL')
      .get(req.params.id);
    if (!row) throw Error('批注或引用已不存在。');
    res.json(markDetail(db, row));
  });
  app.post('/api/reading/marks', credentialGuard, (req, res) =>
    res.json(createMark(db, req.body, { dir })),
  );
  app.post('/api/reading/marks/:id', credentialGuard, (req, res) =>
    res.json(updateMark(db, req.params.id, req.body)),
  );
  app.get('/api/quick-draft', (_req, res) => res.json(quickDraft(dir)));
  app.put('/api/quick-draft', credentialGuard, (req, res) =>
    res.json(saveQuickDraft(db, dir, req.body)),
  );
  app.delete('/api/quick-draft', credentialGuard, (req, res) =>
    res.json(saveQuickDraft(db, dir, req.body, true)),
  );
  app.get('/api/drafts/:key', (req, res) => {
    const d = readWorkspace(dir).drafts[req.params.key];
    res.json(
      d
        ? {
            ...d,
            cover: d.form.cover_asset_id
              ? db.prepare('SELECT filename FROM assets WHERE id=?').get(d.form.cover_asset_id)
                  ?.filename
              : null,
          }
        : null,
    );
  });
  app.put('/api/drafts/:key', (req, res) => {
    if (req.params.key === 'quick') throw Error('快速草稿请使用专用版本校验接口。');
    const w = readWorkspace(dir);
    w.drafts[req.params.key] = {
      form: req.body.form,
      baseUpdatedAt: req.body.baseUpdatedAt || '',
      savedAt: new Date().toISOString(),
    };
    const normalized = validateWorkspace(w),
      draft = normalized.drafts[req.params.key].form;
    if (
      draft.cover_asset_id &&
      !db.prepare('SELECT id FROM assets WHERE id=?').get(draft.cover_asset_id)
    )
      throw new Error('草稿封面不存在。');
    for (const src of draft.content.matchAll(/src="\/assets\/([^"]+)"/g))
      if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(src[1]))
        throw new Error('草稿图片不存在，请重新上传。');
    const result = writeWorkspace(dir, normalized);
    res.json({ savedAt: result.drafts[req.params.key].savedAt });
  });
  app.delete('/api/drafts/:key', (req, res) => {
    if (req.params.key === 'quick') throw Error('快速草稿请使用专用版本校验接口。');
    const w = readWorkspace(dir);
    delete w.drafts[req.params.key];
    writeWorkspace(dir, w);
    res.json({ ok: true });
  });
  app.get('/api/duplicate', (req, res) =>
    res.json({
      duplicate: findDuplicate(db, String(req.query.url || ''), String(req.query.exclude || '')),
    }),
  );
  app.post('/api/batch', (req, res) => res.json(batchEntries(db, req.body)));
  app.patch('/api/entries/:id/pin', (req, res) =>
    res.json(batchEntries(db, { ids: [req.params.id], action: req.body.pinned ? 'pin' : 'unpin' })),
  );
  app.get('/api/entries/:id/versions', (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT * FROM content_versions WHERE entry_id=? ORDER BY created_at DESC,id DESC LIMIT 50',
        )
        .all(req.params.id),
    ),
  );
  app.get('/api/entries/:id', (req, res) => {
    const entry = hydrate(db, db.prepare('SELECT * FROM entries WHERE id=?').get(req.params.id));
    entry ? res.json(entry) : res.status(404).json({ error: '条目不存在。' });
  });
  for (const method of ['post', 'put'])
    app[method]('/api/entries' + (method === 'put' ? '/:id' : ''), (req, res) => {
      const result = saveEntry(db, req.body, req.params.id);
      res.status(result.duplicate ? 409 : 200).json(result);
    });
  app.delete('/api/entries/:id', (req, res) => {
    res.json(setLifecycle(db, req.params.id, { action: 'trash', confirm: '移入回收站' }));
  });
  app.post('/api/taxonomy/:kind', (req, res) => {
    const k = req.params.kind;
    if (!kinds.includes(k)) throw new Error('分类类型无效。');
    const name = req.body.name?.trim();
    if (typeof name !== 'string' || !name || name.length > 50)
      throw new Error('名称必填，最多 50 字。');
    if (k === 'domains') return res.json(saveDomain(db, req.body));
    const id = randomUUID();
    db.prepare(`INSERT INTO ${k}(id,name) VALUES(?,?)`).run(id, name);
    res.json({ id, name });
  });
  app.put('/api/taxonomy/:kind/:id', (req, res) => {
    const k = req.params.kind;
    if (!kinds.includes(k)) throw new Error('分类类型无效。');
    const name = req.body.name?.trim();
    if (typeof name !== 'string' || !name || name.length > 50)
      throw new Error('名称必填，最多 50 字。');
    if (k === 'domains') return res.json(saveDomain(db, req.body, req.params.id));
    if (k === 'collections')
      saveCollection(db, req.params.id, { ...getCollection(db, req.params.id), name });
    else db.prepare(`UPDATE ${k} SET name=? WHERE id=?`).run(name, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/taxonomy/:kind/:id', (req, res) => {
    const k = req.params.kind;
    if (!kinds.includes(k)) throw new Error('分类类型无效。');
    if (k === 'domains') return res.json(deleteDomain(db, req.params.id));
    if (
      db
        .prepare('SELECT rules_json FROM collection_rules')
        .all()
        .some((r) => r.rules_json.includes(req.params.id)) ||
      db
        .prepare('SELECT filters_json FROM library_views')
        .all()
        .some((r) => r.filters_json.includes(req.params.id))
    )
      throw Error('筛选规则仍引用此分类，请先修改规则。');
    db.prepare(`DELETE FROM ${k} WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.post('/api/assets', upload.single('image'), maintenance, async (req, res, next) => {
    uploads++;
    try {
      if (
        !req.file ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(req.file.mimetype)
      )
        throw new Error('仅支持 JPG、PNG、WebP、GIF，最大 10 MB。');
      const image = sharp(req.file.buffer, { limitInputPixels: 40_000_000 });
      const meta = await image.metadata();
      const expected = {
        'image/jpeg': 'jpeg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      if (meta.format !== expected[req.file.mimetype])
        throw new Error('图片实际格式与文件类型不一致。');
      const bytes = await image
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
      const id = randomUUID(),
        filename = id + '.webp';
      writeFileSync(path.join(dir, 'attachments', filename), bytes);
      db.prepare('INSERT INTO assets VALUES(?,?,?,?)').run(
        id,
        filename,
        'image/webp',
        bytes.length,
      );
      res.json({ id, url: '/assets/' + filename });
    } catch (e) {
      next(e);
    } finally {
      uploads--;
    }
  });
  app.get('/assets/:filename', (req, res) => {
    if (
      !/^[a-f0-9-]+\.webp$/.test(req.params.filename) ||
      !db.prepare('SELECT id FROM assets WHERE filename=?').get(req.params.filename)
    )
      return res.sendStatus(404);
    res.sendFile(path.join(dir, 'attachments', req.params.filename));
  });
  app.post('/api/backup', async (_req, res, next) => {
    if (uploads) return res.status(503).json({ error: '图片仍在上传，请稍后备份。' });
    busy = true;
    try {
      const bytes = await exportBackup(db, dir);
      res
        .type('application/zip')
        .attachment('knowledge-' + Date.now() + '.zip')
        .send(bytes);
    } catch (e) {
      next(e);
    } finally {
      busy = false;
    }
  });
  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  });
  app.post('/api/restore/inspect', importUpload.single('backup'), maintenance, (req, res) => {
    if (!req.file) throw new Error('请选择备份压缩包。');
    const checked = validateBackup(req.file.buffer);
    try {
      res.json({ count: checked.count, createdAt: checked.createdAt });
    } finally {
      checked.dispose();
    }
  });
  app.post('/api/restore', importUpload.single('backup'), maintenance, async (req, res, next) => {
    if (req.body.confirm !== '恢复当前知识库') throw new Error('请输入恢复确认文字。');
    if (uploads) return res.status(503).json({ error: '图片仍在上传，请稍后恢复。' });
    if (!req.file) throw new Error('请选择备份压缩包。');
    const checked = validateBackup(req.file.buffer);
    busy = true;
    let newMoved = false;
    const old = path.join(dir, 'previous-' + randomUUID());
    const stage = path.join(dir, 'restore-' + randomUUID());
    try {
      // Fully decode every image before changing current data.
      for (const a of new DatabaseAssets(checked.tmp)) {
        const image = sharp(readFileSync(a), { limitInputPixels: 40_000_000 });
        if ((await image.metadata()).format !== 'webp')
          throw new Error('备份附件不是有效的 WebP 图片。');
        await image.webp().toBuffer();
      }
      const bytes = await exportBackup(db, dir);
      mkdirSync(path.join(dir, 'backups'), { recursive: true });
      const safe = path.join(dir, 'backups', 'before-restore-' + Date.now() + '.zip');
      writeFileSync(safe, bytes);
      mkdirSync(stage);
      // 临时解压目录可能在系统盘，data 可能在其他盘：rename 跨盘会失败，需回退为复制。
      const relocate = (from, to) => {
        try {
          renameSync(from, to);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          cpSync(from, to, { recursive: true });
          rmSync(from, { recursive: true, force: true });
        }
      };
      if (existsSync(path.join(checked.tmp, workspaceName)))
        relocate(path.join(checked.tmp, workspaceName), path.join(stage, workspaceName));
      else writeFileSync(path.join(stage, workspaceName), JSON.stringify(defaultWorkspace()));
      relocate(path.join(checked.tmp, 'library.sqlite'), path.join(stage, 'library.sqlite'));
      relocate(path.join(checked.tmp, 'attachments'), path.join(stage, 'attachments'));
      mkdirSync(old);
      writeFileSync(path.join(dir, journalName), JSON.stringify({ previous: path.basename(old) }));
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      for (const name of [
        'library.sqlite',
        'library.sqlite-wal',
        'library.sqlite-shm',
        'attachments',
        workspaceName,
      ])
        if (existsSync(path.join(dir, name)))
          renameSync(path.join(dir, name), path.join(old, name));
      renameSync(path.join(stage, 'library.sqlite'), path.join(dir, 'library.sqlite'));
      renameSync(path.join(stage, 'attachments'), path.join(dir, 'attachments'));
      renameSync(path.join(stage, workspaceName), path.join(dir, workspaceName));
      newMoved = true;
      db = open();
      rmSync(path.join(dir, journalName));
      res.json({ ok: true, safetyBackup: safe, count: checked.count });
      // Retain the old directory as an additional recovery point; never delete personal data.
    } catch (e) {
      if (existsSync(path.join(dir, journalName))) {
        try {
          db.close();
        } catch {}
        recoverInterruptedRestore(dir);
        db = open();
      } else {
        try {
          db.prepare('SELECT 1').get();
        } catch {
          db = open();
        }
      }
      next(e);
    } finally {
      checked.dispose();
      if (newMoved && existsSync(stage)) rmSync(stage, { recursive: true, force: true });
      busy = false;
    }
  });
  const workspaceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 512 * 1024 * 1024, files: 1 },
  });
  app.get('/api/workspace/info', (_req, res) => {
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    res.json({
      workspaceVersion: '1.0.0',
      knowledgeVersion: '1.9.0',
      dataPath: dir,
      backupDir: path.join(dir, 'backups'),
      knowledgeSchema: schema,
      tasks: { ...tasks.stats(), dbFile: path.join(dir, 'tasks.db') },
      knowledge: {
        entries: db.prepare('SELECT COUNT(*) n FROM entries').get().n,
        attachments: db.prepare('SELECT COUNT(*) n FROM assets').get().n,
      },
    });
  });
  app.post('/api/workspace/backup', async (_req, res, next) => {
    if (uploads) return res.status(503).json({ error: '图片仍在上传，请稍后备份。' });
    busy = true;
    try {
      const { bytes, manifest } = await buildWorkspaceBackup({
        dataDir: dir,
        db,
        taskStore: tasks,
        appVersion: '1.0.0',
      });
      res
        .type('application/zip')
        .attachment('PersonalWorkspace-' + manifest.createdAt.slice(0, 10) + '.zip')
        .send(bytes);
    } catch (e) {
      next(e);
    } finally {
      busy = false;
    }
  });
  app.post(
    '/api/workspace/restore/inspect',
    workspaceUpload.single('backup'),
    maintenance,
    (req, res, next) => {
      try {
        if (!req.file) throw new Error('请选择备份文件。');
        const kind = classifyBackup(req.file.buffer);
        if (kind === 'knowledge') {
          const checked = validateBackup(req.file.buffer);
          try {
            res.json({ type: 'knowledge', count: checked.count, createdAt: checked.createdAt });
          } finally {
            checked.dispose();
          }
          return;
        }
        if (kind !== 'workspace') throw new Error('无法识别的备份格式，已拒绝读取。');
        const parsed = inspectWorkspaceBackup(req.file.buffer);
        try {
          res.json({
            type: 'workspace',
            createdAt: parsed.manifest.createdAt,
            knowledge: parsed.knowledge,
            tasks: parsed.tasks,
          });
        } finally {
          parsed.dispose();
        }
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    '/api/workspace/restore',
    workspaceUpload.single('backup'),
    maintenance,
    async (req, res, next) => {
      if (uploads) return res.status(503).json({ error: '图片仍在上传，请稍后恢复。' });
      if (!req.file) throw new Error('请选择备份文件。');
      if (req.body.confirm !== '恢复工作空间') throw new Error('请输入恢复确认文字。');
      const kind = classifyBackup(req.file.buffer);
      if (kind === 'knowledge')
        return res.status(409).json({
          error:
            '这是旧版知识库备份。请在同一窗口使用下方「旧版知识库备份」入口；该操作只恢复知识库，任务台数据保持不变。',
          code: 'legacy_knowledge',
        });
      if (kind !== 'workspace') throw new Error('无法识别的备份格式，已拒绝恢复。');
      let parsed;
      busy = true;
      try {
        parsed = inspectWorkspaceBackup(req.file.buffer);
        const result = await restoreWorkspaceBackup({
          parsed,
          dataDir: dir,
          getDb: () => db,
          getTasks: () => tasks,
          buildSafetyBackup: async () =>
            (
              await buildWorkspaceBackup({
                dataDir: dir,
                db,
                taskStore: tasks,
                appVersion: '1.0.0',
              })
            ).bytes,
          closeKnowledge: () => db.close(),
          openKnowledge: () => open(),
          openTasks,
          setKnowledgeDb: (next) => {
            db = next;
          },
          setTasks: (next) => {
            tasks = next;
          },
          setBusy: (value) => {
            busy = value;
          },
        });
        res.json(result);
      } catch (e) {
        next(e);
      } finally {
        parsed?.dispose();
        busy = false;
      }
    },
  );
  app.post('/api/workspace/tasks/import', async (req, res, next) => {
    if (uploads) return res.status(503).json({ error: '图片仍在上传，请稍后导入。' });
    if (req.body?.confirm !== '导入任务备份') throw new Error('请确认导入任务备份。');
    const before = tasks.exportPayload();
    const beforeAnalysis = analyzeTasks(before.tasks);
    const incoming = tasks.validateSnapshot(req.body?.payload);
    busy = true;
    try {
      mkdirSync(path.join(dir, 'backups'), { recursive: true });
      const snapshot = path.join(dir, 'backups', 'tasks-before-import-' + Date.now() + '.json');
      writeFileSync(snapshot, JSON.stringify(before, null, 2), 'utf8');
      const restored = tasks.replaceAll({ tasks: incoming });
      const after = analyzeTasks(restored);
      const expected = analyzeTasks(incoming);
      if (after.digest !== expected.digest) {
        tasks.replaceAll(before);
        throw new Error('导入后核对失败，已回滚到导入前的任务数据。');
      }
      res.json({
        ok: true,
        count: after.total,
        analysis: after,
        before: beforeAnalysis,
        snapshot,
      });
    } catch (e) {
      next(e);
    } finally {
      busy = false;
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*rest}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  app.use((err, _req, res, _next) => {
    if (_req.path.startsWith('/api/ai') || err.type === 'entity.parse.failed')
      return res
        .status(400)
        .json({ error: '请求格式无效或操作失败；请检查输入，原配置保持不变。' });
    console.error(err.message);
    res.status(400).json({
      error:
        err.code === 'LIMIT_FILE_SIZE'
          ? '文件过大：图片最大 10 MB，备份最大 256 MB。'
          : err.message?.includes('UNIQUE constraint')
            ? '该名称已经存在。'
            : err.message || '操作失败，请重试。',
    });
  });
  return {
    app,
    close: () => {
      try {
        tasks.close();
      } catch {
        /* ignore */
      }
      db.close();
    },
    getDb: () => db,
    getTasks: () => tasks,
  };
}
// Read attachment paths from an isolated, already validated backup.
import { DatabaseSync } from 'node:sqlite';
function DatabaseAssets(tmp) {
  const d = new DatabaseSync(path.join(tmp, 'library.sqlite'), { readOnly: true });
  try {
    return d
      .prepare('SELECT filename FROM assets')
      .all()
      .map((a) => path.join(tmp, 'attachments', a.filename));
  } finally {
    d.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('尚未构建网页。请先运行 npm run build，或双击启动知识库.bat。');
    process.exit(1);
  }
  let release;
  try {
    const dataDir = path.resolve(
      process.env.PW_DATA_DIR || process.env.PK_DATA_DIR || path.join(root, 'data'),
    );
    release = acquireDataLock(dataDir);
    process.once('exit', release);
    let server,
      stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.closeIdleConnections();
      server.close(() => {
        close();
        process.exit(0);
      });
    };
    const instanceToken = JSON.parse(
      readFileSync(path.join(dataDir, '.server-lock.json'), 'utf8'),
    ).token;
    const { app, close } = createApp(dataDir, { instanceToken, onShutdown: stop });
    const port = Number(process.env.PORT || 5180);
    server = app.listen(port, '127.0.0.1', (error) =>
      error
        ? undefined
        : console.log(
            `个人工作空间已启动：http://127.0.0.1:${port}\n前台按 Ctrl+C；后台使用停止脚本或网页设置正常停止。`,
          ),
    );
    server.on('error', (e) => {
      console.error(
        e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭已有服务或设置 PORT。` : e.message,
      );
      close();
      process.exit(1);
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () =>
        server.close(() => {
          close();
          process.exit(0);
        }),
      );
  } catch (e) {
    release?.();
    console.error('启动失败：' + e.message);
    process.exit(1);
  }
}
