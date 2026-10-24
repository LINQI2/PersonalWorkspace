import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.js'
import { createApp } from './app.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.TASKHUB_DATA_DIR
  ? path.resolve(process.env.TASKHUB_DATA_DIR)
  : path.join(rootDir, 'data')
const backupDir = path.join(dataDir, 'backups')
const dbFile = path.join(dataDir, 'taskhub.db')
const port = Number(process.env.PORT ?? 5175)
const host = process.env.HOST ?? '127.0.0.1'

const store = createStore({ dbFile, backupDir })
store.autoSnapshot()

const app = createApp({
  store,
  staticDir: path.join(rootDir, 'dist'),
  dataDir,
  backupDir,
  onShutdown: () => shutdown('本地停止请求'),
})

const server = app.listen(port, host, () => {
  const stats = store.stats()
  console.log('')
  console.log('  PersonalTaskHub 个人任务台已启动')
  console.log(`  地址: http://${host}:${port}`)
  console.log(`  数据库: ${dbFile}`)
  console.log(`  备份目录: ${backupDir}`)
  console.log(`  当前任务数: ${stats.total}`)
  console.log('  停止服务: 关闭本窗口，或运行 stop.bat')
  console.log('')

  if (process.env.TASKHUB_OPEN === '1') {
    setTimeout(() => openBrowser(`http://${host}:${port}`), 500)
  }
})

function openBrowser(url) {
  try {
    const command =
      process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    /* 打开浏览器失败时用户可以手动访问地址 */
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。可先运行 stop.bat，或设置其他端口：set PORT=5176 && npm start`)
    process.exit(1)
  }
  throw err
})

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`\n[taskhub] 收到 ${signal}，正在保存并关闭...`)
  server.close(() => {
    store.close()
    process.exit(0)
  })
  server.closeAllConnections?.()
  setTimeout(() => {
    store.close()
    process.exit(0)
  }, 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
