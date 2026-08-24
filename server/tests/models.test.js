import mongoose from 'mongoose'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import User from '../src/models/User.js'
import WebhookEvent from '../src/models/WebhookEvent.js'

const userId = new mongoose.Types.ObjectId()
const orderId = new mongoose.Types.ObjectId()

describe('database models', () => {
  it('rejects an invalid user email', async () => {
    await expect(new User({ name: 'Ada', email: 'invalid' }).validate()).rejects.toThrow()
  })

  it('validates an order with items and rejects an empty item list', async () => {
    const order = new Order({ userId, orderNumber: 'PG-100', amount: 1000, currency: 'inr', items: [{ name: 'Item', quantity: 1, unitAmount: 1000 }] })
    await expect(order.validate()).resolves.toBeUndefined()
    expect(order.currency).toBe('INR')
    await expect(new Order({ userId, orderNumber: 'PG-101', amount: 1000, currency: 'INR', items: [] }).validate()).rejects.toThrow()
  })

  it('requires a safe idempotency key and a positive attempt number', async () => {
    const payment = new Payment({ orderId, razorpayOrderId: 'order_test', amount: 1000, currency: 'INR', attemptNumber: 0, idempotencyKey: 'short' })
    await expect(payment.validate()).rejects.toThrow()
  })

  it('requires a webhook event ID and payload', async () => {
    await expect(new WebhookEvent({ eventType: 'payment.captured' }).validate()).rejects.toThrow()
  })

  it('declares reliability indexes without nullable unique-key conflicts', () => {
    const paymentIndexes = Payment.schema.indexes()
    expect(paymentIndexes).toContainEqual([{ razorpayPaymentId: 1 }, { unique: true, sparse: true }])
    expect(paymentIndexes).toContainEqual([{ idempotencyKey: 1 }, { unique: true }])
    expect(Order.schema.indexes()).toContainEqual([{ orderNumber: 1 }, { unique: true }])
    expect(WebhookEvent.schema.indexes()).toContainEqual([{ eventId: 1 }, { unique: true }])
  })
})
