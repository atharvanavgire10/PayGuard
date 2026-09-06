import { jest } from '@jest/globals'
import { createReconciliationWorker, DEFAULT_RECONCILIATION_INTERVAL_MS, getReconciliationIntervalMs, startDevelopmentReconciliationWorker } from '../src/services/payment/reconciliationWorker.js'
import OperationalEvent from '../src/models/OperationalEvent.js'

afterEach(() => jest.restoreAllMocks())

const availableLock = () => ({ acquire: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(undefined) })

describe('reconciliation worker', () => {
  it('starts a development scheduler with the default five-minute interval', () => {
    const setIntervalFn = jest.fn(() => 'timer')
    const worker = startDevelopmentReconciliationWorker({ nodeEnv: 'development', run: jest.fn(), setIntervalFn, lock: availableLock() })
    expect(worker).not.toBeNull()
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), DEFAULT_RECONCILIATION_INTERVAL_MS)
  })

  it('runs the existing reconciliation callback when scheduled', async () => {
    const run = jest.fn().mockResolvedValue({ scanned: 0 })
    let scheduled
    const worker = createReconciliationWorker({ run, intervalMs: 1000, setIntervalFn: jest.fn((callback) => { scheduled = callback; return 'timer' }), lock: availableLock() })
    worker.start()
    scheduled()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips an overlapping scheduled execution', async () => {
    let resolveRun
    const run = jest.fn(() => new Promise((resolve) => { resolveRun = resolve }))
    const worker = createReconciliationWorker({ run, intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), lock: availableLock() })
    const first = worker.runOnce()
    await Promise.resolve()
    await expect(worker.runOnce()).resolves.toEqual({ skipped: true })
    expect(run).toHaveBeenCalledTimes(1)
    resolveRun()
    await first
    expect(worker.isRunning()).toBe(false)
  })

  it('stops cleanly and clears its scheduled timer', () => {
    const clearIntervalFn = jest.fn()
    const worker = createReconciliationWorker({ run: jest.fn(), intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), clearIntervalFn, lock: availableLock() })
    expect(worker.start()).toBe(true)
    expect(worker.stop()).toBe(true)
    expect(clearIntervalFn).toHaveBeenCalledWith('timer')
    expect(worker.stop()).toBe(false)
  })

  it('does not start outside development or when disabled or invalid', () => {
    expect(startDevelopmentReconciliationWorker({ nodeEnv: 'production', run: jest.fn(), lock: availableLock() })).toBeNull()
    expect(getReconciliationIntervalMs('0')).toBeNull()
    expect(getReconciliationIntervalMs('not-a-number')).toBeNull()
    expect(startDevelopmentReconciliationWorker({ nodeEnv: 'development', intervalMs: null, run: jest.fn(), lock: availableLock() })).toBeNull()
  })

  it('runs reconciliation only after acquiring the distributed lock', async () => {
    const lock = { acquire: jest.fn().mockResolvedValue(false), release: jest.fn() }
    const run = jest.fn()
    const worker = createReconciliationWorker({ run, intervalMs: 1000, lock })
    await expect(worker.runOnce()).resolves.toEqual({ skipped: true })
    expect(run).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('releases the distributed lock after successful and failed reconciliation', async () => {
    const successLock = availableLock()
    await createReconciliationWorker({ run: jest.fn().mockResolvedValue({}), intervalMs: 1000, lock: successLock }).runOnce()
    expect(successLock.release).toHaveBeenCalledTimes(1)

    const failureLock = availableLock()
    const recordFailure = jest.fn().mockResolvedValue(undefined)
    const worker = createReconciliationWorker({ run: jest.fn().mockRejectedValue(new Error('unavailable')), intervalMs: 1000, lock: failureLock, recordFailure })
    await worker.runOnce()
    expect(failureLock.release).toHaveBeenCalledTimes(1)
    expect(recordFailure).toHaveBeenCalledTimes(1)
  })

  it('continues running after a worker failure', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ scanned: 0 })
    const worker = createReconciliationWorker({ run, intervalMs: 1000, lock: availableLock(), recordFailure: jest.fn().mockResolvedValue(undefined) })
    await expect(worker.runOnce()).resolves.toEqual({ skipped: false, failed: true })
    await expect(worker.runOnce()).resolves.toEqual({ skipped: false })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('records a safe structured event for a worker failure', async () => {
    jest.spyOn(OperationalEvent, 'create').mockResolvedValue({})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await createReconciliationWorker({ run: jest.fn().mockRejectedValue(new Error('RAZORPAY_KEY_SECRET=never-store')), intervalMs: 1000, lock: availableLock() }).runOnce()
    expect(OperationalEvent.create).toHaveBeenCalledWith({ type: 'RECONCILIATION_WORKER_FAILED', status: 'failed' })
    expect(JSON.stringify(OperationalEvent.create.mock.calls)).not.toContain('never-store')
  })
})
