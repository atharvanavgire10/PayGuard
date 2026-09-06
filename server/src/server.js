import 'dotenv/config'
import app from './app.js'
import { assertEnvironment } from './config/env.js'
import { connectToDatabase, disconnectFromDatabase } from './config/database.js'
import { startDevelopmentReconciliationWorker } from './services/payment/reconciliationWorker.js'

const port = process.env.PORT || 5000
const SHUTDOWN_TIMEOUT_MS = 10 * 1000

async function start() {
  // Fails fast with variable names only, never values.
  const { nodeEnv, warnings } = assertEnvironment()
  for (const warning of warnings) console.warn(`PayGuard configuration warning: ${warning}`)

  await connectToDatabase()
  const server = app.listen(port, () => console.log(`PayGuard server listening on port ${port} (${nodeEnv})`))
  const reconciliationWorker = startDevelopmentReconciliationWorker()

  let shuttingDown = false
  async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`PayGuard shutting down (${signal}).`)

    // Never hang a container on a stuck connection or an unresponsive database.
    const forceExit = setTimeout(() => { console.error('PayGuard shutdown timed out; exiting.'); process.exit(1) }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()

    try {
      // Stop accepting work first, then let the reconciliation worker finish its current run so it
      // releases the distributed lock itself. Abandoning it would leave the lock held until its TTL
      // expires and block the next deployment's worker for up to ten minutes.
      await new Promise((resolve) => server.close(resolve))
      await reconciliationWorker?.shutdown()
      await disconnectFromDatabase()
      clearTimeout(forceExit)
      process.exit(0)
    } catch (error) {
      console.error(`PayGuard shutdown failed: ${error.message}`)
      process.exit(1)
    }
  }

  process.once('SIGINT', () => { void shutdown('SIGINT') })
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
}

start().catch((error) => {
  console.error(`PayGuard API failed to start: ${error.message}`)
  process.exit(1)
})
