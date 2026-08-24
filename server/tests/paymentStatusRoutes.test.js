import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import request from 'supertest'
import app from '../src/app.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'

const paymentId = new mongoose.Types.ObjectId()
const orderId = new mongoose.Types.ObjectId()
const createdAt = new Date('2026-01-02T03:04:05.000Z')
const payment = { _id: paymentId, orderId, status: 'UNKNOWN', amount: 129900, currency: 'INR', method: 'upi', razorpayOrderId: 'order_test', razorpayPaymentId: 'pay_test', createdAt, updatedAt: createdAt }
const order = { _id: orderId, orderNumber: 'PG-100', status: 'PAYMENT_REVIEW', paymentStatus: 'UNKNOWN' }

function mockExistingRecords() {
  jest.spyOn(Payment, 'findById').mockResolvedValue(payment)
  jest.spyOn(Order, 'findById').mockResolvedValue(order)
  jest.spyOn(Payment, 'findOne').mockReturnValue({ sort: jest.fn().mockResolvedValue(payment) })
  jest.spyOn(PaymentEvent, 'find').mockReturnValue({ sort: jest.fn().mockResolvedValue([{ type: 'PAYMENT_CREATED', status: 'completed', occurredAt: createdAt }]) })
}

describe('read-only payment and order status API', () => {
  afterEach(() => jest.restoreAllMocks())

  it('returns an existing payment with authoritative associated order status and real timeline entries', async () => {
    mockExistingRecords()
    const response = await request(app).get(`/api/payments/${paymentId}/status`)
    expect(response.status).toBe(200)
    expect(response.body.payment.status).toBe('UNKNOWN')
    expect(response.body.order).toEqual(expect.objectContaining({ orderNumber: 'PG-100', status: 'PAYMENT_REVIEW' }))
    expect(response.body.timeline).toEqual([{ type: 'PAYMENT_CREATED', status: 'completed', timestamp: createdAt.toJSON() }])
  })

  it('returns an existing order with its associated payment', async () => {
    mockExistingRecords()
    const response = await request(app).get(`/api/orders/${orderId}/status`)
    expect(response.status).toBe(200)
    expect(response.body.order.paymentStatus).toBe('UNKNOWN')
    expect(response.body.payment.id).toBe(paymentId.toString())
  })

  it('returns 404 for a nonexistent payment or order', async () => {
    jest.spyOn(Payment, 'findById').mockResolvedValue(null)
    jest.spyOn(Order, 'findById').mockResolvedValue(null)
    const missingPayment = await request(app).get(`/api/payments/${paymentId}/status`)
    const missingOrder = await request(app).get(`/api/orders/${orderId}/status`)
    expect(missingPayment.status).toBe(404)
    expect(missingOrder.status).toBe(404)
  })

  it('returns 400 for malformed identifiers', async () => {
    const response = await request(app).get('/api/payments/not-an-id/status')
    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Invalid payment identifier.')
  })

  it('never includes credentials or sensitive payment data', async () => {
    mockExistingRecords()
    const response = await request(app).get(`/api/payments/${paymentId}/status`)
    const responseText = JSON.stringify(response.body).toLowerCase()
    expect(responseText).not.toContain('razorpay_key_secret')
    expect(responseText).not.toContain('webhook_secret')
    expect(responseText).not.toContain('cvv')
    expect(responseText).not.toContain('card_number')
  })
})
