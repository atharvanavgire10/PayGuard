// Phase 14 — reliability dashboard coverage.
// The dashboard is read-only, so these tests assert it reports stored state faithfully and
// never invents a failure: a freshly created order (paymentStatus CREATED, payment PENDING)
// must NOT be reported as a mismatch.
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import request from 'supertest'
import app from '../src/app.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import OperationalEvent from '../src/models/OperationalEvent.js'
import WebhookEvent from '../src/models/WebhookEvent.js'
import { REASONS, detectMismatch, isStalePending } from '../src/services/payment/reconciliationService.js'

const originalEnv = process.env
const orderId = new mongoose.Types.ObjectId()
const paymentId = new mongoose.Types.ObjectId()
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000)

// Mongoose query chains used by the service always terminate in .lean()
const query = (result) => { const chained = { sort: () => chained, limit: () => chained, lean: async () => result }; return chained }
const payment = (overrides = {}) => ({ _id: paymentId, orderId, razorpayOrderId: 'order_test', razorpayPaymentId: 'pay_test', amount: 129900, currency: 'INR', method: 'upi', status: 'CAPTURED', createdAt: minutesAgo(30), updatedAt: minutesAgo(29), ...overrides })
const order = (overrides = {}) => ({ _id: orderId, orderNumber: 'PG-100', status: 'PAID', paymentStatus: 'CAPTURED', amount: 129900, currency: 'INR', ...overrides })

function mockCounts(counts = {}) {
  const values = { payments: 4, captured: 1, pending: 1, failed: 1, unknown: 1, paid: 1, review: 1, webhookFailed: 1, webhookWithPayment: 3, autoRecovered: 2, manualReview: 1, reconciliationFailures: 0, workerFailures: 0, ...counts }
  jest.spyOn(Payment, 'countDocuments').mockImplementation(async (filter = {}) => filter.status ? { CAPTURED: values.captured, PENDING: values.pending, FAILED: values.failed, UNKNOWN: values.unknown }[filter.status] : values.payments)
  jest.spyOn(Order, 'countDocuments').mockImplementation(async (filter = {}) => filter.status === 'PAID' ? values.paid : values.review)
  jest.spyOn(WebhookEvent, 'countDocuments').mockImplementation(async (filter = {}) => filter.status === 'FAILED' ? values.webhookFailed : values.webhookWithPayment)
  jest.spyOn(WebhookEvent, 'distinct').mockResolvedValue(values.distinct || ['pay_a', 'pay_b'])
  jest.spyOn(PaymentEvent, 'countDocuments').mockImplementation(async (filter = {}) => filter.type === 'ORDER_REPAIRED' ? values.autoRecovered : filter.type === 'MANUAL_REVIEW_REQUIRED' ? values.manualReview : values.reconciliationFailures)
  jest.spyOn(PaymentEvent, 'find').mockReturnValue(query(values.recentActivity || []))
  jest.spyOn(OperationalEvent, 'countDocuments').mockResolvedValue(values.workerFailures)
  jest.spyOn(OperationalEvent, 'find').mockReturnValue(query(values.recentWorkerActivity || []))
}

function mockLists({ payments = [payment()], orders = [order()], failedWebhooks = [] } = {}) {
  jest.spyOn(Payment, 'find').mockReturnValue(query(payments))
  jest.spyOn(Order, 'find').mockReturnValue(query(orders))
  jest.spyOn(WebhookEvent, 'find').mockReturnValue(query(failedWebhooks))
}

beforeEach(() => { process.env = { ...originalEnv, NODE_ENV: 'development', DASHBOARD_PENDING_MINUTES: '15' } })
afterEach(() => { jest.restoreAllMocks(); process.env = originalEnv })

describe('mismatch detection', () => {
  it('does not flag a freshly created order whose payment is still pending', () => {
    expect(detectMismatch(payment({ status: 'PENDING' }), order({ status: 'PENDING_PAYMENT', paymentStatus: 'CREATED' }))).toEqual({ consistent: true, reasons: [] })
  })

  it('flags a captured payment whose order was never marked paid', () => {
    const result = detectMismatch(payment({ status: 'CAPTURED' }), order({ status: 'PENDING_PAYMENT', paymentStatus: 'CAPTURED' }))
    expect(result.consistent).toBe(false)
    expect(result.reasons).toContain(REASONS.CAPTURED_ORDER_NOT_PAID)
  })

  it('flags a paid order whose payment is not captured', () => {
    const result = detectMismatch(payment({ status: 'FAILED' }), order({ status: 'PAID', paymentStatus: 'CAPTURED' }))
    expect(result.consistent).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([REASONS.PAID_ORDER_NOT_CAPTURED, REASONS.ORDER_PAYMENT_STATUS_DRIFT]))
  })

  it('flags a payment whose order record is missing', () => {
    expect(detectMismatch(payment(), null)).toEqual({ consistent: false, reasons: [REASONS.ORDER_MISSING] })
  })

  it('treats a consistent captured pair as reconciled', () => {
    expect(detectMismatch(payment({ status: 'CAPTURED' }), order()).consistent).toBe(true)
  })
})

describe('stale pending detection', () => {
  it('ignores a pending payment inside the threshold and flags one beyond it', () => {
    expect(isStalePending(payment({ status: 'PENDING', createdAt: minutesAgo(2) }), Date.now(), 15)).toBe(false)
    expect(isStalePending(payment({ status: 'PENDING', createdAt: minutesAgo(45) }), Date.now(), 15)).toBe(true)
  })

  it('never flags a settled payment as stale regardless of age', () => {
    expect(isStalePending(payment({ status: 'CAPTURED', createdAt: minutesAgo(500) }), Date.now(), 15)).toBe(false)
  })
})

describe('GET /api/dashboard/summary', () => {
  it('reports counts derived from stored records', async () => {
    mockCounts({ recentActivity: [{ type: 'ORDER_REPAIRED', occurredAt: new Date('2026-08-24T10:00:00.000Z') }] })
    const response = await request(app).get('/api/dashboard/summary')
    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining({ totalPayments: 4, capturedPayments: 1, pendingPayments: 1, failedPayments: 1, unknownPayments: 1, paidOrders: 1, ordersRequiringAttention: 1, failedWebhookEvents: 1, totalAutoRecovered: 2, totalManualReview: 1, totalReconciliationFailures: 0, lastReconciliationActivity: { outcome: 'AUTO_RECOVERED', occurredAt: '2026-08-24T10:00:00.000Z' } }))
  })

  it('derives duplicate webhook events from repeated gateway payment ids', async () => {
    mockCounts({ webhookWithPayment: 5, distinct: ['pay_a', 'pay_b'] })
    const response = await request(app).get('/api/dashboard/summary')
    expect(response.body.duplicateWebhookEvents).toBe(3)
  })

  it('returns zeroes rather than failing when there is no data', async () => {
    mockCounts({ payments: 0, captured: 0, pending: 0, failed: 0, unknown: 0, paid: 0, review: 0, webhookFailed: 0, webhookWithPayment: 0, autoRecovered: 0, manualReview: 0, reconciliationFailures: 0, workerFailures: 0, distinct: [] })
    const response = await request(app).get('/api/dashboard/summary')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ totalPayments: 0, capturedPayments: 0, pendingPayments: 0, failedPayments: 0, unknownPayments: 0, paidOrders: 0, ordersRequiringAttention: 0, duplicateWebhookEvents: 0, failedWebhookEvents: 0, totalAutoRecovered: 0, totalManualReview: 0, totalReconciliationFailures: 0, lastReconciliationActivity: null })
  })

  it('reports reconciliation and worker failures with the latest failure activity', async () => {
    mockCounts({ reconciliationFailures: 2, workerFailures: 1, recentActivity: [{ type: 'PAYMENT_RECONCILIATION_FAILED', occurredAt: new Date('2026-08-24T10:00:00.000Z') }], recentWorkerActivity: [{ type: 'RECONCILIATION_WORKER_FAILED', occurredAt: new Date('2026-08-24T11:00:00.000Z') }] })
    const response = await request(app).get('/api/dashboard/summary')
    expect(response.body.totalReconciliationFailures).toBe(3)
    expect(response.body.lastReconciliationActivity).toEqual({ outcome: 'WORKER_FAILURE', occurredAt: '2026-08-24T11:00:00.000Z' })
  })
})

describe('GET /api/dashboard/payments', () => {
  it('returns recent activity joined to its order', async () => {
    mockLists()
    const response = await request(app).get('/api/dashboard/payments')
    expect(response.status).toBe(200)
    expect(response.body.payments).toHaveLength(1)
    expect(response.body.payments[0]).toEqual(expect.objectContaining({ orderNumber: 'PG-100', razorpayPaymentId: 'pay_test', amount: 129900, currency: 'INR', paymentStatus: 'CAPTURED', orderStatus: 'PAID' }))
  })

  it('returns an empty list when no payments exist', async () => {
    mockLists({ payments: [], orders: [] })
    const response = await request(app).get('/api/dashboard/payments')
    expect(response.status).toBe(200)
    expect(response.body.payments).toEqual([])
  })

  it('never exposes secrets or sensitive payment credentials', async () => {
    mockLists()
    const response = await request(app).get('/api/dashboard/payments')
    const body = JSON.stringify(response.body).toLowerCase()
    for (const secret of ['razorpay_key_secret', 'webhook_secret', 'cvv', 'card_number', 'upi_pin', 'idempotencykey', 'signatureverified']) expect(body).not.toContain(secret)
  })
})

describe('GET /api/dashboard/attention', () => {
  it('includes an UNKNOWN payment and an order under review', async () => {
    mockLists({ payments: [payment({ status: 'UNKNOWN' })], orders: [order({ status: 'PAYMENT_REVIEW', paymentStatus: 'UNKNOWN' })] })
    const response = await request(app).get('/api/dashboard/attention')
    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].reasons).toEqual(expect.arrayContaining([REASONS.UNKNOWN_PAYMENT, REASONS.ORDER_UNDER_REVIEW]))
  })

  it('includes a pending payment older than the threshold', async () => {
    mockLists({ payments: [payment({ status: 'PENDING', createdAt: minutesAgo(90) })], orders: [order({ status: 'PENDING_PAYMENT', paymentStatus: 'CREATED' })] })
    const response = await request(app).get('/api/dashboard/attention')
    expect(response.body.thresholdMinutes).toBe(15)
    expect(response.body.items[0].reasons).toEqual([REASONS.STALE_PENDING_PAYMENT])
  })

  it('marks a payment/order state mismatch', async () => {
    mockLists({ payments: [payment({ status: 'CAPTURED' })], orders: [order({ status: 'PENDING_PAYMENT', paymentStatus: 'CAPTURED' })] })
    const response = await request(app).get('/api/dashboard/attention')
    expect(response.body.items[0].mismatch).toBe(true)
    expect(response.body.items[0].reasons).toContain(REASONS.CAPTURED_ORDER_NOT_PAID)
  })

  it('includes webhook processing failures reported by the database', async () => {
    mockLists({ payments: [], orders: [], failedWebhooks: [{ eventId: 'evt_1', eventType: 'payment.captured', status: 'FAILED', error: 'Matching payment was not found.', payload: { paymentId: 'pay_x', orderId: 'order_x' }, createdAt: minutesAgo(5) }] })
    const response = await request(app).get('/api/dashboard/attention')
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toEqual(expect.objectContaining({ kind: 'WEBHOOK', eventId: 'evt_1', reasons: [REASONS.WEBHOOK_PROCESSING_FAILED] }))
  })

  it('excludes healthy records and returns an empty queue for consistent data', async () => {
    mockLists({ payments: [payment({ status: 'CAPTURED' })], orders: [order()] })
    const response = await request(app).get('/api/dashboard/attention')
    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
  })
})

describe('GET /api/dashboard/reconciliation/:paymentId', () => {
  function mockReconciliation({ paymentRecord = payment(), orderRecord = order() } = {}) {
    jest.spyOn(Payment, 'findById').mockReturnValue(query(paymentRecord))
    jest.spyOn(Order, 'findById').mockReturnValue(query(orderRecord))
    jest.spyOn(PaymentEvent, 'find').mockReturnValue(query([{ type: 'PAYMENT_CAPTURED', status: 'completed', occurredAt: minutesAgo(29) }]))
    jest.spyOn(WebhookEvent, 'find').mockReturnValue(query([{ eventId: 'evt_1', eventType: 'payment.captured', status: 'PROCESSED', createdAt: minutesAgo(29), processedAt: minutesAgo(29) }]))
  }

  it('compares stored payment and order state without calling Razorpay', async () => {
    mockReconciliation()
    const response = await request(app).get(`/api/dashboard/reconciliation/${paymentId}`)
    expect(response.status).toBe(200)
    expect(response.body.source).toBe('payguard-database')
    expect(response.body.reconciliation.consistent).toBe(true)
    expect(response.body.timeline).toHaveLength(1)
    expect(response.body.webhookEvents[0].eventId).toBe('evt_1')
  })

  it('reports the reasons a record is inconsistent', async () => {
    mockReconciliation({ paymentRecord: payment({ status: 'CAPTURED' }), orderRecord: order({ status: 'PENDING_PAYMENT', paymentStatus: 'CAPTURED' }) })
    const response = await request(app).get(`/api/dashboard/reconciliation/${paymentId}`)
    expect(response.body.reconciliation.consistent).toBe(false)
    expect(response.body.reconciliation.reasons).toContain(REASONS.CAPTURED_ORDER_NOT_PAID)
  })

  it('returns 400 for a malformed identifier and 404 for a missing payment', async () => {
    const malformed = await request(app).get('/api/dashboard/reconciliation/not-an-id')
    expect(malformed.status).toBe(400)
    jest.spyOn(Payment, 'findById').mockReturnValue(query(null))
    const missing = await request(app).get(`/api/dashboard/reconciliation/${paymentId}`)
    expect(missing.status).toBe(404)
  })
})

describe('development-only exposure', () => {
  it('hides every dashboard route in production', async () => {
    process.env.NODE_ENV = 'production'
    for (const path of ['/api/dashboard/summary', '/api/dashboard/payments', '/api/dashboard/attention', `/api/dashboard/reconciliation/${paymentId}`]) {
      expect((await request(app).get(path)).status).toBe(404)
    }
  })

  it('leaves existing non-dashboard routes reachable', async () => {
    process.env.NODE_ENV = 'production'
    expect((await request(app).get('/api/health')).status).not.toBe(404)
  })
})
