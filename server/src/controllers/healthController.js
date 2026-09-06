import { getDatabaseStatus } from '../config/database.js'

export function getHealth(_request, response) {
  response.status(200).json({
    status: 'ok',
    service: 'payguard-api',
    database: getDatabaseStatus(),
  })
}

// Liveness (getHealth) answers "is the process up". Readiness answers "can it serve payment
// traffic", which requires the database, so an orchestrator can withhold traffic during startup
// or a database outage. Neither response includes configuration values, secrets, versions,
// dependency names, or error details.
export function getReadiness(_request, response) {
  const database = getDatabaseStatus()
  const ready = database === 'connected'
  response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', database })
}
