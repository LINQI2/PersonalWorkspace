import express from 'express';
import { TaskStoreError } from './store.js';

/**
 * 任务台 API，挂载在 /api/tasks 命名空间下。
 * 同源、Host、Origin、X-PK-Request、维护门与请求体上限由统一 createApp 中间件负责。
 * getStore 为惰性访问器，恢复工作空间后可以替换底层数据库连接。
 */
export function createTaskRouter(getStore) {
  const router = express.Router();
  const wrap = (handler) => (req, res, next) => {
    try {
      handler(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get('/', (_req, res) => {
    res.json({ tasks: getStore().listTasks() });
  });

  router.get('/info', (_req, res) => {
    const store = getStore();
    res.json({
      dbFile: store.dbFile,
      stats: store.stats(),
      integrity: store.integrity(),
    });
  });

  router.post(
    '/',
    wrap((req, res) => {
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body))
        throw new TaskStoreError('请求内容格式不正确');
      const { parentId = null, title, note = '', afterId = null, beforeId = null, status } = body;
      const task = getStore().createTask({ parentId, title, note, afterId, beforeId, status });
      res.status(201).json({ task });
    }),
  );

  router.patch(
    '/:id',
    wrap((req, res) => {
      res.json({ task: getStore().updateTask(req.params.id, req.body ?? {}) });
    }),
  );

  router.post(
    '/:id/move',
    wrap((req, res) => {
      const { parentId = null, index = 0 } = req.body ?? {};
      res.json(getStore().moveTask(req.params.id, { parentId, index }));
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      res.json(getStore().deleteTask(req.params.id));
    }),
  );

  /** 整表替换，用于任务台撤销与旧任务 JSON 导入。 */
  router.put(
    '/',
    wrap((req, res) => {
      res.json({ tasks: getStore().replaceAll(req.body ?? {}) });
    }),
  );

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof TaskStoreError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: '任务数据过大' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求内容不是合法的 JSON' });
      return;
    }
    console.error('[tasks] 未处理的错误:', err);
    res.status(500).json({ error: '任务模块操作失败，数据未改变' });
  });

  return router;
}
