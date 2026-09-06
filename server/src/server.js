import 'dotenv/config'
import app from './app.js'
import { connectToDatabase } from './config/database.js'
import { startDevelopmentReconciliationWorker } from './services/payment/reconciliationWorker.js'

const port = process.env.PORT || 5000

async function start() {
  await connectToDatabase()
  const server = app.listen(port, () => console.log(`PayGuard server listening on port ${port}`))
  const reconciliationWorker = startDevelopmentReconciliationWorker()

  const shutdown = () => {
    reconciliationWorker?.stop()
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

start().catch((error) => {
  console.error(`PayGuard API failed to start: ${error.message}`)
  process.exit(1)
})
