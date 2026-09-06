import { jest } from '@jest/globals'
import { createReconciliationWorker, DEFAULT_RECONCILIATION_INTERVAL_MS, getReconciliationIntervalMs, startDevelopmentReconciliationWorker } from '../src/services/payment/reconciliationWorker.js'

afterEach(() => jest.restoreAllMocks())

describe('reconciliation worker', () => {
  it('starts a development scheduler with the default five-minute interval', () => {
    const setIntervalFn = jest.fn(() => 'timer')
    const worker = startDevelopmentReconciliationWorker({ nodeEnv: 'development', run: jest.fn(), setIntervalFn })
    expect(worker).not.toBeNull()
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), DEFAULT_RECONCILIATION_INTERVAL_MS)
  })

  it('runs the existing reconciliation callback when scheduled', async () => {
    const run = jest.fn().mockResolvedValue({ scanned: 0 })
    let scheduled
    const worker = createReconciliationWorker({ run, intervalMs: 1000, setIntervalFn: jest.fn((callback) => { scheduled = callback; return 'timer' }) })
    worker.start()
    scheduled()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips an overlapping scheduled execution', async () => {
    let resolveRun
    const run = jest.fn(() => new Promise((resolve) => { resolveRun = resolve }))
    const worker = createReconciliationWorker({ run, intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer') })
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
    const worker = createReconciliationWorker({ run: jest.fn(), intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), clearIntervalFn })
    expect(worker.start()).toBe(true)
    expect(worker.stop()).toBe(true)
    expect(clearIntervalFn).toHaveBeenCalledWith('timer')
    expect(worker.stop()).toBe(false)
  })

  it('does not start outside development or when disabled or invalid', () => {
    expect(startDevelopmentReconciliationWorker({ nodeEnv: 'production', run: jest.fn() })).toBeNull()
    expect(getReconciliationIntervalMs('0')).toBeNull()
    expect(getReconciliationIntervalMs('not-a-number')).toBeNull()
    expect(startDevelopmentReconciliationWorker({ nodeEnv: 'development', intervalMs: null, run: jest.fn() })).toBeNull()
  })
})
