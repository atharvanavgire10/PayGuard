import crypto from 'crypto'
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { processRazorpayWebhook } from '../src/services/payment/razorpayWebhookService.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import WebhookEvent from '../src/models/WebhookEvent.js'

const originalEnv = process.env
const raw = (event, status = 'captured') => Buffer.from(JSON.stringify({ event, payload: { payment: { entity: { id: 'pay_gateway', order_id: 'order_gateway', status, amount: 129900, currency: 'INR', method: 'upi' } } } }))
const signature = (body) => crypto.createHmac('sha256', 'webhook_secret').update(body).digest('hex')

beforeEach(() => { process.env = { ...originalEnv, RAZORPAY_WEBHOOK_SECRET: 'webhook_secret' } })
afterEach(() => { jest.restoreAllMocks(); process.env = originalEnv })

function mockRecords(paymentStatus = 'PENDING', orderStatus = 'PENDING_PAYMENT') {
  const orderId = new mongoose.Types.ObjectId(); const payment = { _id: new mongoose.Types.ObjectId(), orderId, status: paymentStatus, razorpayOrderId: 'order_gateway', save: jest.fn() }; const order = { _id: orderId, status: orderStatus, paymentStatus: paymentStatus, save: jest.fn() }; const webhook = { status: 'PROCESSING', save: jest.fn() }
  jest.spyOn(WebhookEvent, 'create').mockResolvedValue(webhook); jest.spyOn(WebhookEvent, 'findOne').mockResolvedValue(webhook); jest.spyOn(Payment, 'findOne').mockResolvedValue(payment); jest.spyOn(Order, 'findById').mockResolvedValue(order); jest.spyOn(PaymentEvent, 'create').mockResolvedValue([])
  return { payment, order }
}

test('valid payment.captured webhook recovers payment and order', async () => {
  const { payment, order } = mockRecords(); const body = raw('payment.captured')
  await expect(processRazorpayWebhook({ rawBody: body, signature: signature(body), eventId: 'evt-captured' })).resolves.toEqual({ processed: true })
  expect(payment.status).toBe('CAPTURED'); expect(order.status).toBe('PAID'); expect(PaymentEvent.create).toHaveBeenCalled()
})

test('payment.failed webhook updates payment and order', async () => {
  const { payment, order } = mockRecords(); const body = raw('payment.failed', 'failed')
  await processRazorpayWebhook({ rawBody: body, signature: signature(body), eventId: 'evt-failed' })
  expect(payment.status).toBe('FAILED'); expect(order.status).toBe('PAYMENT_FAILED')
})

test('invalid signature is rejected before storage', async () => {
  const webhookCreate = jest.spyOn(WebhookEvent, 'create')
  await expect(processRazorpayWebhook({ rawBody: raw('payment.captured'), signature: 'invalid', eventId: 'evt-invalid' })).rejects.toThrow('Invalid webhook signature.')
  expect(webhookCreate).not.toHaveBeenCalled()
})

test('duplicate webhook is idempotent and creates no payment events', async () => {
  jest.spyOn(WebhookEvent, 'create').mockRejectedValue({ code: 11000 })
  const body = raw('payment.captured')
  await expect(processRazorpayWebhook({ rawBody: body, signature: signature(body), eventId: 'evt-duplicate' })).resolves.toEqual({ duplicate: true })
  const paymentEventCreate = jest.spyOn(PaymentEvent, 'create'); const findOrder = jest.spyOn(Order, 'findById')
  expect(paymentEventCreate).not.toHaveBeenCalled(); expect(findOrder).not.toHaveBeenCalled()
})

test('unknown payment is safely recorded without creating an order', async () => {
  const webhook = { status: 'PROCESSING', save: jest.fn() }; jest.spyOn(WebhookEvent, 'create').mockResolvedValue(webhook); jest.spyOn(WebhookEvent, 'findOne').mockResolvedValue(webhook); jest.spyOn(Payment, 'findOne').mockResolvedValue(null)
  const body = raw('payment.captured')
  await expect(processRazorpayWebhook({ rawBody: body, signature: signature(body), eventId: 'evt-missing' })).resolves.toEqual({ ignored: true })
  const findOrder = jest.spyOn(Order, 'findById'); expect(webhook.status).toBe('FAILED'); expect(findOrder).not.toHaveBeenCalled()
})
