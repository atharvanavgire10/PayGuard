// Covers only the Phase 22 production-readiness surfaces: startup configuration validation, the
// readiness probe, graceful worker shutdown, and error-response safety. Payment, webhook, and
// reconciliation behaviour is covered by the existing suites and is not re-tested here.
import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import app from '../src/app.js'
import { assertEnvironment, auditEnvironment } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { AppError } from '../src/utils/AppError.js'
import { createReconciliationWorker } from '../src/services/payment/reconciliationWorker.js'

afterEach(() => jest.restoreAllMocks())

const availableLock = () => ({ acquire: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(undefined) })
const complete = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1:27017/payguard', RAZORPAY_KEY_ID: 'rzp_test_example', RAZORPAY_KEY_SECRET: 'secret_value_never_logged', RAZORPAY_WEBHOOK_SECRET: 'webhook_value_never_logged', CLIENT_URL: 'https://shop.example.com' }

describe('startup configuration audit', () => {
  it('accepts a complete production configuration', () => {
    const audit = auditEnvironment(complete)
    expect(audit.valid).toBe(true)
    expect(audit.missing).toEqual([])
    expect(audit.nodeEnv).toBe('production')
  })

  it('requires only the database outside production so local development can boot unconfigured', () => {
    expect(auditEnvironment({ NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/payguard' }).valid).toBe(true)
    expect(auditEnvironment({ NODE_ENV: 'development' }).missing).toEqual(['MONGODB_URI'])
  })

  it('reports every missing production secret by name', () => {
    const audit = auditEnvironment({ NODE_ENV: 'production' })
    expect(audit.valid).toBe(false)
    expect(audit.missing).toEqual(['MONGODB_URI', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'CLIENT_URL'])
  })

  it('treats a blank or whitespace-only value as missing', () => {
    expect(auditEnvironment({ NODE_ENV: 'production', ...complete, RAZORPAY_KEY_SECRET: '   ' }).missing).toEqual(['RAZORPAY_KEY_SECRET'])
  })

  it('never includes a configured value in the thrown message, only variable names', () => {
    const incomplete = { ...complete, MONGODB_URI: '' }
    expect(() => assertEnvironment(incomplete)).toThrow('Missing required environment variables: MONGODB_URI')
    try {
      assertEnvironment(incomplete)
    } catch (error) {
      for (const secret of ['secret_value_never_logged', 'webhook_value_never_logged', 'rzp_test_example']) expect(error.message).not.toContain(secret)
    }
  })

  it('warns instead of failing when the Razorpay key is not a Test Mode key', () => {
    const audit = auditEnvironment({ ...complete, RAZORPAY_KEY_ID: 'rzp_live_example' })
    expect(audit.valid).toBe(true)
    expect(audit.warnings).toContainEqual(expect.stringContaining('Test Mode'))
    expect(JSON.stringify(audit.warnings)).not.toContain('rzp_live_example')
  })

  it('returns no warnings for a correct Test Mode production configuration', () => {
    expect(auditEnvironment(complete).warnings).toEqual([])
  })
})

describe('health and readiness probes', () => {
  it('keeps the existing liveness response unchanged', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', service: 'payguard-api', database: 'disconnected' })
  })

  // No database connection exists in the suite, which is exactly the "do not send traffic yet" case.
  it('reports 503 not-ready while the database is unreachable', async () => {
    const response = await request(app).get('/api/health/ready')
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'not-ready', database: 'disconnected' })
  })

  it('exposes no configuration, secrets, or internal details in either probe', async () => {
    for (const path of ['/api/health', '/api/health/ready']) {
      const response = await request(app).get(path)
      const body = JSON.stringify(response.body).toLowerCase()
      for (const leak of ['mongodb', 'razorpay', 'secret', 'key', 'uri', 'password', 'version', 'stack', 'node_env', 'localhost', 'env']) expect(body).not.toContain(leak)
      expect(Object.keys(response.body).length).toBeLessThanOrEqual(3)
    }
  })

  it('stays reachable when development-only surfaces are disabled', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const [live, ready] = [await request(app).get('/api/health'), await request(app).get('/api/health/ready')]
    process.env.NODE_ENV = previous
    expect(live.status).toBe(200)
    expect(ready.status).toBe(503)
  })
})

describe('graceful worker shutdown', () => {
  it('releases the distributed lock by awaiting the in-flight run instead of abandoning it', async () => {
    const lock = availableLock()
    let finishRun
    const run = jest.fn(() => new Promise((resolve) => { finishRun = resolve }))
    const worker = createReconciliationWorker({ run, intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), clearIntervalFn: jest.fn(), lock })
    worker.start()

    const inFlight = worker.runOnce()
    await Promise.resolve()
    expect(lock.release).not.toHaveBeenCalled()

    const shuttingDown = worker.shutdown()
    finishRun()
    await shuttingDown
    await inFlight

    expect(lock.release).toHaveBeenCalledTimes(1)
    expect(worker.isRunning()).toBe(false)
  })

  it('clears the scheduled timer during shutdown', async () => {
    const clearIntervalFn = jest.fn()
    const worker = createReconciliationWorker({ run: jest.fn(), intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), clearIntervalFn, lock: availableLock() })
    worker.start()
    await expect(worker.shutdown()).resolves.toBe(true)
    expect(clearIntervalFn).toHaveBeenCalledWith('timer')
  })

  it('resolves rather than throwing when the in-flight run fails during shutdown', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const lock = availableLock()
    const worker = createReconciliationWorker({ run: jest.fn().mockRejectedValue(new Error('database unavailable')), intervalMs: 1000, setIntervalFn: jest.fn(() => 'timer'), lock, recordFailure: jest.fn().mockResolvedValue(undefined) })
    worker.start()
    void worker.runOnce()
    await expect(worker.shutdown()).resolves.toBe(true)
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('is safe to call without a started schedule or an in-flight run', async () => {
    const worker = createReconciliationWorker({ run: jest.fn(), intervalMs: 1000, lock: availableLock() })
    await expect(worker.shutdown()).resolves.toBe(false)
  })
})

describe('error response safety', () => {
  function failingApp(error) {
    const testApp = express()
    testApp.get('/boom', (_request, _response, next) => next(error))
    testApp.use(errorHandler)
    return testApp
  }

  it('collapses an unexpected failure to a generic message with no stack or driver detail', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const leaky = new Error('MongoServerError: authentication failed for mongodb://user:hunter2@cluster/payguard')
    const response = await request(failingApp(leaky)).get('/boom')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: { message: 'An unexpected server error occurred.' } })
    const serialized = JSON.stringify(response.body)
    for (const leak of ['hunter2', 'mongodb://', 'MongoServerError', 'authentication failed']) expect(serialized).not.toContain(leak)
  })

  it('logs an unexpected failure without the message, body, or query string', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {})
    await request(failingApp(new Error('RAZORPAY_KEY_SECRET=leaked'))).get('/boom?razorpay_signature=abcdef')
    expect(logged).toHaveBeenCalledTimes(1)
    const line = logged.mock.calls[0].join(' ')
    expect(line).toContain('GET /boom')
    expect(line).toContain('Error')
    for (const leak of ['leaked', 'RAZORPAY_KEY_SECRET', 'abcdef', 'razorpay_signature']) expect(line).not.toContain(leak)
  })

  it('passes a deliberate AppError message through and logs nothing for it', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {})
    const response = await request(failingApp(new AppError(404, 'Payment not found.'))).get('/boom')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: { message: 'Payment not found.' } })
    expect(logged).not.toHaveBeenCalled()
  })
})
