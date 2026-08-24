import request from 'supertest'
import { jest } from '@jest/globals'

const createCheckoutOrder = jest.fn()
jest.unstable_mockModule('../src/services/payment/checkoutService.js', () => ({
  createCheckoutOrder,
  verifyCheckoutPayment: jest.fn(),
}))

const { default: app } = await import('../src/app.js')

afterEach(() => jest.clearAllMocks())

test('POST /api/orders parses the browser JSON body and returns safe checkout data', async () => {
  const payload = { customer: { name: 'PayGuard Test Customer', email: 'test@example.com' }, items: [{ sku: 'payguard-demo-order', quantity: 1 }] }
  createCheckoutOrder.mockResolvedValue({ orderId: 'local-order-id', paymentId: 'local-payment-id', orderNumber: 'PG-100', razorpayOrderId: 'order_gateway', amount: 129900, currency: 'INR', razorpayKeyId: 'rzp_test_key' })
  const response = await request(app).post('/api/orders').send(payload)
  expect(response.status).toBe(201)
  expect(createCheckoutOrder).toHaveBeenCalledWith(payload)
  expect(response.body).toEqual(expect.objectContaining({ orderId: 'local-order-id', paymentId: 'local-payment-id', razorpayOrderId: 'order_gateway' }))
  expect(JSON.stringify(response.body)).not.toContain('SECRET')
})
