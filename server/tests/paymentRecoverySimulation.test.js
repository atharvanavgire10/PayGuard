// Phase 13 — payment failure/recovery coverage.
// These tests drive the real razorpayWebhookService against an in-memory store so duplicate
// prevention is asserted by counting records, not by trusting mock call order.
import crypto from 'crypto'
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { processRazorpayWebhook } from '../src/services/payment/razorpayWebhookService.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import WebhookEvent from '../src/models/WebhookEvent.js'

const originalEnv = process.env
const RAZORPAY_ORDER_ID = 'order_SIMrecovery'
const capturedBody = () => Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_SIMrecovery', order_id: RAZORPAY_ORDER_ID, status: 'captured', amount: 129900, currency: 'INR', method: 'upi' } } } }))
const sign = (body) => crypto.createHmac('sha256', 'webhook_secret').update(body).digest('hex')

beforeEach(() => { process.env = { ...originalEnv, RAZORPAY_WEBHOOK_SECRET: 'webhook_secret' } })
afterEach(() => { jest.restoreAllMocks(); process.env = originalEnv })

// Mirrors the ambiguous state left behind when the browser never returns from the gateway:
// one Order, one Payment, seeded timeline events, and nothing captured yet.
function seedAmbiguousStore({ paymentStatus = 'PENDING', orderStatus = 'PENDING_PAYMENT' } = {}) {
  const orderId = new mongoose.Types.ObjectId()
  const payment = { _id: new mongoose.Types.ObjectId(), orderId, razorpayOrderId: RAZORPAY_ORDER_ID, status: paymentStatus, save: jest.fn(async () => payment) }
  const order = { _id: orderId, status: orderStatus, paymentStatus, save: jest.fn(async () => order) }
  const store = { payment, order, webhookEvents: [], paymentEvents: [{ type: 'PAYMENT_CREATED' }, { type: 'PAYMENT_PENDING' }] }

  jest.spyOn(WebhookEvent, 'create').mockImplementation(async (document) => {
    if (store.webhookEvents.some((event) => event.eventId === document.eventId)) { const conflict = new Error('duplicate key'); conflict.code = 11000; throw conflict }
    const record = { ...document, save: jest.fn(async () => record) }
    store.webhookEvents.push(record)
    return record
  })
  jest.spyOn(WebhookEvent, 'findOne').mockImplementation(async ({ eventId }) => store.webhookEvents.find((event) => event.eventId === eventId) || null)
  jest.spyOn(Payment, 'findOne').mockImplementation(async () => payment)
  jest.spyOn(Order, 'findById').mockImplementation(async () => order)
  jest.spyOn(PaymentEvent, 'create').mockImplementation(async (documents) => { const created = Array.isArray(documents) ? documents : [documents]; store.paymentEvents.push(...created); return created })
  // Recovery must never mint a second Order or Payment, so creation is trapped rather than mocked away.
  jest.spyOn(Order, 'create').mockImplementation(async () => { throw new Error('Order.create must not be called during webhook recovery') })
  jest.spyOn(Payment, 'create').mockImplementation(async () => { throw new Error('Payment.create must not be called during webhook recovery') })

  store.countEvents = (type) => store.paymentEvents.filter((event) => event.type === type).length
  return store
}

const deliver = (eventId, body = capturedBody()) => processRazorpayWebhook({ rawBody: body, signature: sign(body), eventId })

describe('Phase 13 payment recovery via verified webhook', () => {
  it('recovers a PENDING payment to CAPTURED and its order to PAID', async () => {
    const store = seedAmbiguousStore({ paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT' })
    await expect(deliver('sim-recovery-pending')).resolves.toEqual({ processed: true })
    expect(store.payment.status).toBe('CAPTURED')
    expect(store.order.status).toBe('PAID')
    expect(store.order.paymentStatus).toBe('CAPTURED')
  })

  it('recovers an UNKNOWN payment under review to CAPTURED and PAID', async () => {
    const store = seedAmbiguousStore({ paymentStatus: 'UNKNOWN', orderStatus: 'PAYMENT_REVIEW' })
    await expect(deliver('sim-recovery-unknown')).resolves.toEqual({ processed: true })
    expect(store.payment.status).toBe('CAPTURED')
    expect(store.order.status).toBe('PAID')
    expect(store.countEvents('PAYMENT_CAPTURED')).toBe(1)
  })

  it('records exactly one processed WebhookEvent and one PAYMENT_CAPTURED event', async () => {
    const store = seedAmbiguousStore()
    await deliver('sim-recovery-single')
    expect(store.webhookEvents).toHaveLength(1)
    expect(store.webhookEvents[0].status).toBe('PROCESSED')
    expect(store.webhookEvents[0].processedAt).toBeInstanceOf(Date)
    expect(store.countEvents('PAYMENT_CAPTURED')).toBe(1)
  })

  it('rejects an invalid signature without storing a webhook or changing state', async () => {
    const store = seedAmbiguousStore()
    const body = capturedBody()
    await expect(processRazorpayWebhook({ rawBody: body, signature: 'not-the-real-signature', eventId: 'sim-recovery-invalid' })).rejects.toThrow('Invalid webhook signature.')
    expect(store.webhookEvents).toHaveLength(0)
    expect(store.payment.status).toBe('PENDING')
    expect(store.order.status).toBe('PENDING_PAYMENT')
    expect(store.countEvents('PAYMENT_CAPTURED')).toBe(0)
  })

  it('treats a repeated event ID as a duplicate and leaves the recovered state untouched', async () => {
    const store = seedAmbiguousStore()
    await expect(deliver('sim-recovery-duplicate')).resolves.toEqual({ processed: true })
    await expect(deliver('sim-recovery-duplicate')).resolves.toEqual({ duplicate: true })
    expect(store.webhookEvents).toHaveLength(1)
    expect(store.countEvents('PAYMENT_CAPTURED')).toBe(1)
    expect(store.payment.status).toBe('CAPTURED')
    expect(store.order.status).toBe('PAID')
  })

  it('never creates a second Order or Payment across duplicate deliveries', async () => {
    const store = seedAmbiguousStore()
    await deliver('sim-recovery-no-duplicates')
    await deliver('sim-recovery-no-duplicates')
    await deliver('sim-recovery-no-duplicates')
    expect(Order.create).not.toHaveBeenCalled()
    expect(Payment.create).not.toHaveBeenCalled()
    expect(store.payment.save).toHaveBeenCalledTimes(1)
    expect(store.order.save).toHaveBeenCalledTimes(1)
    expect(store.countEvents('PAYMENT_CAPTURED')).toBe(1)
  })
})
