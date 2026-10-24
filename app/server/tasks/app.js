import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { StoreError } from './store.js'

/**
 * 创建 Express 应用。store 与静态资源目录可注入，便于测试。
 */
export function createApp({ store, staticDir, dataDir, backupDir, onShutdown }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '20mb' }))

  const wrap = (handler) => (req, res, next) => {
    try {
      handler(req, res)
    } catch (err) {
      next(err)
    }
  }

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/info', (req, res) => {
    res.json({
      dataDir,
      dbFile: store.dbFile,
      backupDir: backupDir ?? store.backupDir,
      stats: store.stats(),
    })
  })

  app.get('/api/tasks', (req, res) => {
    res.json({ tasks: store.listTasks() })
  })

  app.post('/api/tasks', wrap((req, res) => {
    const { parentId = null, title, afterId = null, beforeId = null, status } = req.body ?? {}
    const task = store.createTask({ parentId, title, afterId, beforeId, status })
    res.status(201).json({ task })
  }))

  app.patch('/api/tasks/:id', wrap((req, res) => {
    const task = store.updateTask(req.params.id, req.body ?? {})
    res.json({ task })
  }))

  app.post('/api/tasks/:id/move', wrap((req, res) => {
    const { parentId = null, index = 0 } = req.body ?? {}
    const result = store.moveTask(req.params.id, { parentId, index })
    res.json(result)
  }))

  app.delete('/api/tasks/:id', wrap((req, res) => {
    const result = store.deleteTask(req.params.id)
    res.json(result)
  }))

  // 整体替换（撤销操作使用）
  app.put('/api/tasks', wrap((req, res) => {
    const tasks = store.replaceAll(req.body ?? {})
    res.json({ tasks })
  }))

  app.get('/api/backup', (req, res) => {
    const payload = store.exportPayload()
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="taskhub-backup-${stamp}.json"`)
    res.send(JSON.stringify(payload, null, 2))
  })

  app.post('/api/backup/snapshot', wrap((req, res) => {
    const result = store.snapshotFile('manual')
    res.json({ file: result.file, taskCount: result.taskCount, backupDir })
  }))

  app.post('/api/backup/restore', wrap((req, res) => {
    const result = store.restoreFromPayload(req.body)
    res.json(result)
  }))

  // 供 stop.bat 使用的本机正常停止接口
  if (typeof onShutdown === 'function') {
    app.post('/api/shutdown', (req, res) => {
      const ip = req.socket.remoteAddress ?? ''
      const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
      if (!local) {
        res.status(403).json({ error: '仅允许本机操作' })
        return
      }
      res.json({ ok: true })
      setTimeout(() => onShutdown(), 150)
    })
  }

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof StoreError) {
      res.status(err.status).json({ error: err.message, code: err.code })
      return
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求内容不是合法的 JSON' })
      return
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: '数据过大' })
      return
    }
    console.error('[taskhub] 未处理的错误:', err)
    res.status(500).json({ error: '服务器内部错误' })
  })

  return app
}
