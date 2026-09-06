// Phase 21 — end-to-end reliability pipeline coverage.
//
// The existing suites verify each stage in isolation with per-file mocks. These tests instead
// wire ONE shared in-memory store through the real webhook service, the real automated
// reconciliation service, the real distributed lock, and the real worker, so a stage observes
// the state the previous stage actually persisted. Idempotency is proven by counting stored
// records, never by trusting mock call order.
//
// No business logic is imported in mocked form: every assertion drives production code paths.
import crypto from 'crypto'
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import request from 'supertest'
import app from '../src/app.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import OperationalEvent from '../src/models/OperationalEvent.js'
import ReconciliationLock from '../src/models/ReconciliationLock.js'
import WebhookEvent from '../src/models/WebhookEvent.js'
import { processRazorpayWebhook } from '../src/services/payment/razorpayWebhookService.js'
import { runAutomatedReconciliation } from '../src/services/payment/automatedReconciliationService.js'
import { acquireReconciliationLock, RECONCILIATION_LOCK_NAME, releaseReconciliationLock } from '../src/services/payment/reconciliationLockService.js'
import { createReconciliationWorker } from '../src/services/payment/reconciliationWorker.js'

const originalEnv = process.env
const WEBHOOK_SECRET = 'phase21_webhook_secret'
const sign = (body) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
const capturedBody = (razorpayOrderId, gatewayPaymentId) => Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: gatewayPaymentId, order_id: razorpayOrderId, status: 'captured', amount: 129900, currency: 'INR', method: 'upi' } } } }))

beforeEach(() => { process.env = { ...originalEnv, NODE_ENV: 'development', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET } })
afterEach(() => { jest.restoreAllMocks(); process.env = originalEnv })

// A single store shared by every service under test. Documents expose save() so the production
// code mutates the same objects the assertions later read back.
function createStore() {
  const store = { orders: [], payments: [], paymentEvents: [], webhookEvents: [], operationalEvents: [], locks: [] }

  store.seed = ({ paymentStatus = 'PENDING', orderStatus = 'PENDING_PAYMENT', orderPaymentStatus, razorpayOrderId = 'order_phase21', razorpayPaymentId } = {}) => {
    const orderId = new mongoose.Types.ObjectId()
    const order = { _id: orderId, orderNumber: `PG-${store.orders.length + 100}`, status: orderStatus, paymentStatus: orderPaymentStatus ?? paymentStatus, amount: 129900, currency: 'INR', updatedAt: new Date(), save: jest.fn(async function () { this.updatedAt = new Date(); return this }) }
    const payment = { _id: new mongoose.Types.ObjectId(), orderId, razorpayOrderId, razorpayPaymentId, amount: 129900, currency: 'INR', status: paymentStatus, updatedAt: new Date(), save: jest.fn(async function () { this.updatedAt = new Date(); return this }) }
    store.orders.push(order); store.payments.push(payment)
    return { order, payment }
  }

  store.countEvents = (type, paymentId) => store.paymentEvents.filter((event) => event.type === type && (!paymentId || event.paymentId.toString() === paymentId.toString())).length
  store.eventTypes = (paymentId) => store.paymentEvents.filter((event) => !paymentId || event.paymentId.toString() === paymentId.toString()).map((event) => event.type)

  jest.spyOn(Order, 'findById').mockImplementation(async (id) => store.orders.find((order) => order._id.toString() === id.toString()) || null)
  jest.spyOn(Payment, 'findOne').mockImplementation(async (filter = {}) => store.payments.find((payment) => payment.razorpayOrderId === filter.razorpayOrderId) || null)
  jest.spyOn(Payment, 'find').mockImplementation((filter = {}) => {
    const wanted = filter.status?.$in
    const matched = store.payments.filter((payment) => !wanted || wanted.includes(payment.status))
    return { sort: async () => [...matched].sort((a, b) => a.updatedAt - b.updatedAt) }
  })

  jest.spyOn(PaymentEvent, 'findOne').mockImplementation(async ({ paymentId, type }) => store.paymentEvents.find((event) => event.paymentId.toString() === paymentId.toString() && event.type === type) || null)
  jest.spyOn(PaymentEvent, 'create').mockImplementation(async (documents) => { const created = Array.isArray(documents) ? documents : [documents]; store.paymentEvents.push(...created); return created })
  jest.spyOn(OperationalEvent, 'create').mockImplementation(async (document) => { store.operationalEvents.push(document); return document })

  jest.spyOn(WebhookEvent, 'create').mockImplementation(async (document) => {
    // Mirrors the unique index on eventId that Phase 12 relies on for redelivery suppression.
    if (store.webhookEvents.some((event) => event.eventId === document.eventId)) { const conflict = new Error('duplicate key'); conflict.code = 11000; throw conflict }
    const record = { ...document, save: jest.fn(async function () { return this }) }
    store.webhookEvents.push(record)
    return record
  })
  jest.spyOn(WebhookEvent, 'findOne').mockImplementation(async ({ eventId }) => store.webhookEvents.find((event) => event.eventId === eventId) || null)

  // Recovery must reuse the existing records, so record creation is trapped rather than stubbed away.
  jest.spyOn(Order, 'create').mockImplementation(async () => { throw new Error('Order.create must not be called during recovery or reconciliation') })
  jest.spyOn(Payment, 'create').mockImplementation(async () => { throw new Error('Payment.create must not be called during recovery or reconciliation') })

  // Emulates MongoDB semantics exactly: the predicate only matches an absent or expired lock, and
  // an upsert that collides with the unique name index surfaces as E11000.
  jest.spyOn(ReconciliationLock, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
    const now = filter.expiresAt.$lte
    const existing = store.locks.find((lock) => lock.name === RECONCILIATION_LOCK_NAME)
    if (existing && existing.expiresAt > now) { const conflict = new Error('duplicate key'); conflict.code = 11000; throw conflict }
    const record = { name: RECONCILIATION_LOCK_NAME, ...update.$set }
    if (existing) Object.assign(existing, update.$set)
    else store.locks.push(record)
    return existing || record
  })
  jest.spyOn(ReconciliationLock, 'deleteOne').mockImplementation(async ({ ownerId }) => {
    const index = store.locks.findIndex((lock) => lock.name === RECONCILIATION_LOCK_NAME && lock.ownerId === ownerId)
    if (index === -1) return { deletedCount: 0 }
    store.locks.splice(index, 1)
    return { deletedCount: 1 }
  })

  return store
}

const deliver = (eventId, razorpayOrderId = 'order_phase21', gatewayPaymentId = 'pay_phase21') => {
  const body = capturedBody(razorpayOrderId, gatewayPaymentId)
  return processRazorpayWebhook({ rawBody: body, signature: sign(body), eventId })
}

describe('Phase 21 — payment recovery through the verified webhook', () => {
  it('recovers a PENDING payment to CAPTURED and its order to PAID, then leaves reconciliation nothing to repair', async () => {
    const store = createStore()
    const { order, payment } = store.seed({ paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })

    await expect(deliver('phase21-recovery')).resolves.toEqual({ processed: true })
    expect(payment.status).toBe('CAPTURED')
    expect(payment.razorpayPaymentId).toBe('pay_phase21')
    expect(payment.capturedAt).toBeInstanceOf(Date)
    expect(order.status).toBe('PAID')
    expect(order.paymentStatus).toBe('CAPTURED')
    expect(store.countEvents('PAYMENT_CAPTURED', payment._id)).toBe(1)
    expect(store.webhookEvents).toHaveLength(1)
    expect(store.webhookEvents[0].status).toBe('PROCESSED')

    // The critical cross-stage property: a webhook-recovered record must not be repaired again.
    const result = await runAutomatedReconciliation()
    expect(result).toEqual(expect.objectContaining({ repaired: 0, manualReview: 0, unchanged: 1 }))
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(0)
    expect(store.countEvents('RECONCILIATION_STARTED', payment._id)).toBe(0)
    expect(order.save).toHaveBeenCalledTimes(1)
  })

  it('never mints a second Order or Payment while recovering', async () => {
    const store = createStore()
    store.seed()
    await deliver('phase21-no-duplicate-records')
    await runAutomatedReconciliation()
    expect(Order.create).not.toHaveBeenCalled()
    expect(Payment.create).not.toHaveBeenCalled()
    expect(store.orders).toHaveLength(1)
    expect(store.payments).toHaveLength(1)
  })
})

describe('Phase 21 — duplicate webhook delivery', () => {
  it('treats a redelivered event id as a duplicate and mutates nothing on the second pass', async () => {
    const store = createStore()
    const { order, payment } = store.seed()

    await expect(deliver('phase21-duplicate')).resolves.toEqual({ processed: true })
    await expect(deliver('phase21-duplicate')).resolves.toEqual({ duplicate: true })
    await expect(deliver('phase21-duplicate')).resolves.toEqual({ duplicate: true })

    expect(store.webhookEvents).toHaveLength(1)
    expect(store.countEvents('PAYMENT_CAPTURED', payment._id)).toBe(1)
    expect(store.countEvents('ORDER_CREATED', payment._id)).toBe(1)
    expect(payment.save).toHaveBeenCalledTimes(1)
    expect(order.save).toHaveBeenCalledTimes(1)
    expect(payment.status).toBe('CAPTURED')
    expect(order.status).toBe('PAID')
  })

  it('keeps duplicate suppression intact when reconciliation runs between deliveries', async () => {
    const store = createStore()
    const { payment } = store.seed()
    await deliver('phase21-duplicate-interleaved')
    await runAutomatedReconciliation()
    await expect(deliver('phase21-duplicate-interleaved')).resolves.toEqual({ duplicate: true })
    expect(store.countEvents('PAYMENT_CAPTURED', payment._id)).toBe(1)
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(0)
    expect(store.webhookEvents).toHaveLength(1)
  })
})

describe('Phase 21 — automated reconciliation closes a genuine state gap', () => {
  it('repairs a CAPTURED payment whose order was left PENDING_PAYMENT', async () => {
    const store = createStore()
    // Models a webhook that captured the payment and then failed before the order was saved.
    const { order, payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })

    const result = await runAutomatedReconciliation()
    expect(result).toEqual(expect.objectContaining({ scanned: 1, repaired: 1, manualReview: 0 }))
    expect(order.status).toBe('PAID')
    expect(order.paymentStatus).toBe('CAPTURED')
    expect(store.eventTypes(payment._id)).toEqual(['RECONCILIATION_STARTED', 'ORDER_REPAIRED'])
  })

  it('repairs an order stranded under review without touching payment state', async () => {
    const store = createStore()
    const { order, payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PAYMENT_REVIEW', orderPaymentStatus: 'UNKNOWN' })
    await runAutomatedReconciliation()
    expect(order.status).toBe('PAID')
    expect(payment.status).toBe('CAPTURED')
    expect(payment.save).not.toHaveBeenCalled()
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(1)
  })
})

describe('Phase 21 — reconciliation idempotency', () => {
  it('repairs on the first run and performs no repair on the second', async () => {
    const store = createStore()
    const { order, payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })

    const first = await runAutomatedReconciliation()
    const second = await runAutomatedReconciliation()

    expect(first).toEqual(expect.objectContaining({ repaired: 1 }))
    expect(second).toEqual(expect.objectContaining({ repaired: 0, unchanged: 1 }))
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(1)
    expect(store.countEvents('RECONCILIATION_STARTED', payment._id)).toBe(1)
    expect(order.save).toHaveBeenCalledTimes(1)
  })

  it('creates no duplicate repair events across many consecutive runs', async () => {
    const store = createStore()
    const { payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })
    for (let run = 0; run < 5; run += 1) await runAutomatedReconciliation()
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(1)
    expect(store.paymentEvents).toHaveLength(2)
  })
})

describe('Phase 21 — unsafe recovery is refused', () => {
  it.each(['PENDING', 'UNKNOWN'])('never promotes a %s payment without definitive gateway success', async (status) => {
    const store = createStore()
    const { order, payment } = store.seed({ paymentStatus: status, orderStatus: status === 'UNKNOWN' ? 'PAYMENT_REVIEW' : 'PENDING_PAYMENT' })

    const result = await runAutomatedReconciliation()

    expect(payment.status).toBe(status)
    expect(order.status).not.toBe('PAID')
    expect(order.paymentStatus).not.toBe('CAPTURED')
    expect(order.save).not.toHaveBeenCalled()
    expect(payment.save).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ repaired: 0, manualReview: 1 }))
    expect(store.eventTypes(payment._id)).toEqual(['MANUAL_REVIEW_REQUIRED'])
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(0)
  })

  it('records the manual-review flag exactly once across repeated runs', async () => {
    const store = createStore()
    const { payment } = store.seed({ paymentStatus: 'UNKNOWN', orderStatus: 'PAYMENT_REVIEW' })
    await runAutomatedReconciliation()
    await runAutomatedReconciliation()
    await runAutomatedReconciliation()
    expect(store.countEvents('MANUAL_REVIEW_REQUIRED', payment._id)).toBe(1)
  })

  it('resolves the same record only once a verified webhook proves capture', async () => {
    const store = createStore()
    const { order, payment } = store.seed({ paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })

    await runAutomatedReconciliation()
    expect(payment.status).toBe('PENDING')
    expect(store.countEvents('MANUAL_REVIEW_REQUIRED', payment._id)).toBe(1)

    await deliver('phase21-unsafe-then-verified')
    expect(payment.status).toBe('CAPTURED')
    expect(order.status).toBe('PAID')

    const after = await runAutomatedReconciliation()
    expect(after).toEqual(expect.objectContaining({ repaired: 0, unchanged: 1 }))
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(0)
  })
})

describe('Phase 21 — worker concurrency under the distributed lock', () => {
  it('lets only one of two simultaneous workers execute reconciliation', async () => {
    const store = createStore()
    store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })
    // Deterministic overlap: worker A is held inside run() until the test releases it, so worker B
    // provably contends for a lock that is already held rather than relying on scheduling luck.
    let releaseFirst
    let signalStarted
    const started = new Promise((resolve) => { signalStarted = resolve })
    const run = jest.fn(() => { signalStarted(); return new Promise((resolve) => { releaseFirst = resolve }) })
    const workerA = createReconciliationWorker({ run, intervalMs: 1000, ownerId: 'worker-a' })
    const workerB = createReconciliationWorker({ run, intervalMs: 1000, ownerId: 'worker-b' })

    const first = workerA.runOnce()
    await started
    await expect(workerB.runOnce()).resolves.toEqual({ skipped: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(store.locks).toHaveLength(1)
    expect(store.locks[0].ownerId).toBe('worker-a')

    releaseFirst()
    await expect(first).resolves.toEqual({ skipped: false })
    expect(store.locks).toHaveLength(0)
  })

  it('does not repair twice when a second worker runs after the first releases the lock', async () => {
    const store = createStore()
    const { payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })
    const workerA = createReconciliationWorker({ run: runAutomatedReconciliation, intervalMs: 1000, ownerId: 'worker-a' })
    const workerB = createReconciliationWorker({ run: runAutomatedReconciliation, intervalMs: 1000, ownerId: 'worker-b' })

    await workerA.runOnce()
    await workerB.runOnce()

    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(1)
    expect(store.locks).toHaveLength(0)
  })

  it('hands the lock to the next worker once the holder releases it', async () => {
    createStore()
    await expect(acquireReconciliationLock({ ownerId: 'worker-a' })).resolves.toBe(true)
    await expect(acquireReconciliationLock({ ownerId: 'worker-b' })).resolves.toBe(false)
    await releaseReconciliationLock({ ownerId: 'worker-a' })
    await expect(acquireReconciliationLock({ ownerId: 'worker-b' })).resolves.toBe(true)
  })

  it('recovers an abandoned lock once its TTL has passed', async () => {
    createStore()
    await expect(acquireReconciliationLock({ ownerId: 'crashed-worker', ttlMs: 1000 })).resolves.toBe(true)
    await expect(acquireReconciliationLock({ ownerId: 'later-worker' })).resolves.toBe(false)
    const afterExpiry = new Date(Date.now() + 5000)
    await expect(acquireReconciliationLock({ ownerId: 'later-worker', now: afterExpiry })).resolves.toBe(true)
  })
})

describe('Phase 21 — worker failure recovery', () => {
  it('records the failure safely, releases the lock, and allows a later run to execute', async () => {
    const store = createStore()
    store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const run = jest.fn().mockRejectedValueOnce(new Error('RAZORPAY_KEY_SECRET=must-never-be-stored')).mockImplementationOnce(runAutomatedReconciliation)
    const worker = createReconciliationWorker({ run, intervalMs: 1000, ownerId: 'worker-a' })

    await expect(worker.runOnce()).resolves.toEqual({ skipped: false, failed: true })
    expect(store.operationalEvents).toEqual([{ type: 'RECONCILIATION_WORKER_FAILED', status: 'failed' }])
    expect(JSON.stringify(store.operationalEvents)).not.toContain('must-never-be-stored')
    expect(store.locks).toHaveLength(0)

    await expect(worker.runOnce()).resolves.toEqual({ skipped: false })
    expect(run).toHaveBeenCalledTimes(2)
    expect(store.orders[0].status).toBe('PAID')
  })

  it('releases the lock even when recording the failure also fails', async () => {
    const store = createStore()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const worker = createReconciliationWorker({ run: jest.fn().mockRejectedValue(new Error('unavailable')), intervalMs: 1000, ownerId: 'worker-a', recordFailure: jest.fn().mockRejectedValue(new Error('audit store down')) })
    await expect(worker.runOnce()).resolves.toEqual({ skipped: false, failed: true })
    expect(store.locks).toHaveLength(0)
    await expect(acquireReconciliationLock({ ownerId: 'worker-b' })).resolves.toBe(true)
  })

  it('surfaces a per-record failure without aborting the rest of the scan', async () => {
    const store = createStore()
    const broken = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', razorpayOrderId: 'order_broken' })
    const healthy = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', razorpayOrderId: 'order_healthy' })
    Order.findById.mockImplementation(async (id) => {
      if (id.toString() === broken.order._id.toString()) throw new Error('database unavailable')
      return store.orders.find((order) => order._id.toString() === id.toString()) || null
    })

    const result = await runAutomatedReconciliation()
    expect(result.failures).toEqual([{ paymentId: broken.payment._id.toString(), message: 'Reconciliation could not process this payment.' }])
    expect(result.repaired).toBe(1)
    expect(healthy.order.status).toBe('PAID')
    expect(store.countEvents('PAYMENT_RECONCILIATION_FAILED', broken.payment._id)).toBe(1)
  })
})

describe('Phase 21 — API security and development-only protection', () => {
  it('rejects an unsigned webhook over HTTP without storing state', async () => {
    const store = createStore()
    const { order, payment } = store.seed()
    const body = capturedBody('order_phase21', 'pay_phase21')

    const response = await request(app).post('/api/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', 'forged-signature').set('x-razorpay-event-id', 'phase21-forged').send(body)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: { message: 'Invalid webhook signature.' } })
    expect(store.webhookEvents).toHaveLength(0)
    expect(payment.status).toBe('PENDING')
    expect(order.status).toBe('PENDING_PAYMENT')
  })

  it('rejects invalid checkout input with a safe validation error and no state change', async () => {
    const store = createStore()
    const response = await request(app).post('/api/orders').send({ customer: { name: '', email: 'not-an-email' }, items: [] })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: { message: 'Invalid request payload.' } })
    expect(store.orders).toHaveLength(0)
    expect(Order.create).not.toHaveBeenCalled()
    expect(Payment.create).not.toHaveBeenCalled()
  })

  // The guard requires NODE_ENV === 'development' exactly, so a non-production-but-not-development
  // deployment must be refused too. Existing coverage only flips to 'production'.
  // Request count here is kept under the endpoint's rate limit (max 5 per window).
  it.each(['production', 'staging', 'test'])('refuses reconciliation and repairs nothing when NODE_ENV is "%s"', async (nodeEnv) => {
    const store = createStore()
    store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })
    process.env.NODE_ENV = nodeEnv

    const response = await request(app).post('/api/reconciliation/run')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: { message: 'Not found.' } })
    expect(store.orders[0].status).toBe('PENDING_PAYMENT')
    expect(store.paymentEvents).toHaveLength(0)
  })

  it('runs reconciliation through the development endpoint and reports the repair', async () => {
    const store = createStore()
    const { payment } = store.seed({ paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', orderPaymentStatus: 'CREATED' })

    const response = await request(app).post('/api/reconciliation/run')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining({ scanned: 1, repaired: 1, manualReview: 0 }))
    expect(store.orders[0].status).toBe('PAID')
    expect(store.countEvents('ORDER_REPAIRED', payment._id)).toBe(1)
    expect(JSON.stringify(response.body)).not.toContain(WEBHOOK_SECRET)
  })
})
