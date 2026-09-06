import { runAutomatedReconciliation } from './automatedReconciliationService.js'
import { randomUUID } from 'node:crypto'
import { acquireReconciliationLock, releaseReconciliationLock } from './reconciliationLockService.js'
import { recordReconciliationWorkerFailure } from './operationalEventService.js'

export const DEFAULT_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000
const MINIMUM_RECONCILIATION_INTERVAL_MS = 1000

export function getReconciliationIntervalMs(value = process.env.RECONCILIATION_INTERVAL_MS) {
  if (value === undefined || value === '') return DEFAULT_RECONCILIATION_INTERVAL_MS
  if (String(value) === '0') return null
  const interval = Number(value)
  return Number.isInteger(interval) && interval >= MINIMUM_RECONCILIATION_INTERVAL_MS ? interval : null
}

// This in-process worker deliberately owns no repair rules. A production queue can replace it
// later while continuing to call the same authoritative reconciliation service.
export function createReconciliationWorker({ run = runAutomatedReconciliation, intervalMs = getReconciliationIntervalMs(), setIntervalFn = setInterval, clearIntervalFn = clearInterval, ownerId = randomUUID(), lock, recordFailure = recordReconciliationWorkerFailure } = {}) {
  let timer = null
  let running = false
  let inFlight = null
  const distributedLock = lock || {
    acquire: () => acquireReconciliationLock({ ownerId }),
    release: () => releaseReconciliationLock({ ownerId }),
  }

  async function execute() {
    if (running) return { skipped: true }
    running = true
    let acquired = false
    try {
      acquired = await distributedLock.acquire()
      if (!acquired) return { skipped: true }
      await run()
      return { skipped: false }
    } catch (error) {
      try { await recordFailure() } catch { console.error('Scheduled reconciliation failure could not be recorded.') }
      console.error('Scheduled reconciliation failed.')
      return { skipped: false, failed: true }
    } finally {
      if (acquired) {
        try { await distributedLock.release() } catch { console.error('Scheduled reconciliation lock release failed.') }
      }
      running = false
    }
  }

  // Tracked so shutdown can await an execution that is already holding the distributed lock. The
  // returned value and the in-process `running` guard are unchanged from the scheduled behaviour.
  function runOnce() {
    inFlight = execute().finally(() => { inFlight = null })
    return inFlight
  }

  return {
    start() {
      if (timer || intervalMs === null) return false
      timer = setIntervalFn(() => { void runOnce() }, intervalMs)
      return true
    },
    stop() {
      if (!timer) return false
      clearIntervalFn(timer)
      timer = null
      return true
    },
    // Stops the schedule and waits for an in-flight execution to finish, which lets its `finally`
    // release the distributed lock instead of abandoning it for the TTL monitor to reclaim.
    async shutdown() {
      const stopped = this.stop()
      try { await inFlight } catch { /* execute() already records and logs its own failures */ }
      return stopped
    },
    runOnce,
    isRunning: () => running,
  }
}

export function startDevelopmentReconciliationWorker(options = {}) {
  if ((options.nodeEnv || process.env.NODE_ENV) !== 'development') return null
  const worker = createReconciliationWorker(options)
  return worker.start() ? worker : null
}
