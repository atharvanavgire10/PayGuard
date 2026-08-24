import 'dotenv/config'
import app from './app.js'
import { connectToDatabase } from './config/database.js'

const port = process.env.PORT || 5000

async function start() {
  await connectToDatabase()
  app.listen(port, () => console.log(`PayGuard server listening on port ${port}`))
}

start().catch((error) => {
  console.error(`PayGuard API failed to start: ${error.message}`)
  process.exit(1)
})
