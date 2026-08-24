import crypto from 'crypto'
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { createCheckoutOrder, verifyCheckoutPayment } from '../src/services/payment/checkoutService.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import User from '../src/models/User.js'

const originalEnv = process.env
beforeEach(() => { process.env = { ...originalEnv, RAZORPAY_KEY_ID: 'rzp_test_example', RAZORPAY_KEY_SECRET: 'test_secret' } })
afterEach(() => { jest.restoreAllMocks(); process.env = originalEnv })

test('checkout validates input and never trusts client amount', async () => {
  await expect(createCheckoutOrder({ amount: 1, items: [] })).rejects.toThrow('Valid customer and items are required.')
})

test('checkout creates local order, Razorpay order, and payment record with server amount', async () => {
  const userId = new mongoose.Types.ObjectId(); const orderId = new mongoose.Types.ObjectId(); const paymentId = new mongoose.Types.ObjectId()
  const localOrder = { _id: orderId, orderNumber: 'PG-100', save: jest.fn() }
  const provider = { createOrder: jest.fn().mockResolvedValue({ id: 'order_gateway' }) }
  jest.spyOn(User, 'findOne').mockResolvedValue({ _id: userId })
  jest.spyOn(Order, 'create').mockResolvedValue(localOrder)
  jest.spyOn(Payment, 'create').mockResolvedValue({ _id: paymentId })
  jest.spyOn(PaymentEvent, 'create').mockResolvedValue([])
  const result = await createCheckoutOrder({ customer: { name: 'Test', email: 'test@example.com' }, items: [{ sku: 'payguard-demo-order', quantity: 1 }], amount: 1 }, { provider })
  expect(Order.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 129900, currency: 'INR' }))
  expect(provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 129900, currency: 'INR' }))
  expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({ orderId, razorpayOrderId: 'order_gateway' }))
  expect(result).toEqual(expect.objectContaining({ orderId: orderId.toString(), paymentId: paymentId.toString(), razorpayOrderId: 'order_gateway' }))
  expect(JSON.stringify(result)).not.toContain('test_secret')
})

test('Razorpay order failure returns no checkout success and removes the unready local order', async () => {
  const orderId = new mongoose.Types.ObjectId(); const localOrder = { _id: orderId, orderNumber: 'PG-101', save: jest.fn() }
  jest.spyOn(User, 'findOne').mockResolvedValue({ _id: new mongoose.Types.ObjectId() })
  jest.spyOn(Order, 'create').mockResolvedValue(localOrder)
  jest.spyOn(Order, 'findByIdAndDelete').mockResolvedValue(localOrder)
  const paymentCreate = jest.spyOn(Payment, 'create')
  await expect(createCheckoutOrder({ customer: { name: 'Test', email: 'test@example.com' }, items: [{ sku: 'payguard-demo-order', quantity: 1 }] }, { provider: { createOrder: jest.fn().mockRejectedValue(new Error('gateway down')) } })).rejects.toThrow('gateway down')
  expect(Order.findByIdAndDelete).toHaveBeenCalledWith(orderId)
  expect(paymentCreate).not.toHaveBeenCalled()
})

test('valid signature uses stored order ID and duplicate verification remains idempotent', async () => {
  const orderId = new mongoose.Types.ObjectId(); const paymentId = new mongoose.Types.ObjectId()
  const payment = { _id: paymentId, orderId, razorpayOrderId: 'order_server', status: 'PENDING', save: jest.fn() }
  const order = { _id: orderId, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', save: jest.fn() }
  jest.spyOn(Payment, 'findOne').mockResolvedValue(payment); jest.spyOn(Order, 'findById').mockResolvedValue(order); jest.spyOn(PaymentEvent, 'create').mockResolvedValue([])
  const signature = crypto.createHmac('sha256', 'test_secret').update('order_server|pay_valid').digest('hex')
  await expect(verifyCheckoutPayment({ razorpay_payment_id: 'pay_valid', razorpay_order_id: 'order_server', razorpay_signature: signature })).resolves.toEqual({ paymentId: paymentId.toString(), orderId: orderId.toString() })
  expect(payment.razorpayOrderId).toBe('order_server'); expect(payment.signatureVerified).toBe(true); expect(payment.status).toBe('CAPTURED'); expect(order.status).toBe('PAID')
  await verifyCheckoutPayment({ razorpay_payment_id: 'pay_valid', razorpay_order_id: 'order_server', razorpay_signature: signature })
  expect(payment.save).toHaveBeenCalledTimes(1)
})

test('invalid signature is rejected without changing state', async () => {
  const payment = { razorpayOrderId: 'order_server', status: 'PENDING' }; jest.spyOn(Payment, 'findOne').mockResolvedValue(payment)
  await expect(verifyCheckoutPayment({ razorpay_payment_id: 'pay_bad', razorpay_order_id: 'order_server', razorpay_signature: 'bad' })).rejects.toThrow('Payment verification failed.')
  expect(payment.status).toBe('PENDING')
})
