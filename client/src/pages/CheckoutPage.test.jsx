import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

const { open, createOrder, verifyPayment, getPaymentStatus } = vi.hoisted(() => ({ open: vi.fn(), createOrder: vi.fn(), verifyPayment: vi.fn(), getPaymentStatus: vi.fn() }))
vi.mock('../services/api.js', () => ({ createOrder, verifyPayment, getPaymentStatus, toSafeApiError: () => 'Payment status is temporarily unavailable.' }))
vi.mock('../services/razorpayCheckout.js', () => ({ loadRazorpayCheckout: vi.fn().mockResolvedValue(), openRazorpayCheckout: open }))
import CheckoutPage from './CheckoutPage.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })

test('Pay starts server order creation and opens checkout with server order details', async () => {
  createOrder.mockResolvedValueOnce({ orderId: 'order-local', paymentId: 'payment-local', orderNumber: 'PG-1', razorpayOrderId: 'order_gateway', amount: 129900, currency: 'INR', razorpayKeyId: 'rzp_test_key' })
  render(<CheckoutPage />, { wrapper: BrowserRouter })
  fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  await waitFor(() => expect(createOrder).toHaveBeenCalled())
  expect(createOrder).toHaveBeenCalledWith({ customer: { name: 'PayGuard Test Customer', email: 'test@example.com' }, items: [{ sku: 'payguard-demo-order', quantity: 1 }] })
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_gateway', key: 'rzp_test_key', amount: 129900 }))
})

test('missing customer is blocked before the order API request', async () => {
  render(<CheckoutPage checkoutCustomer={null} />, { wrapper: BrowserRouter })
  fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  expect(screen.getByRole('alert')).toHaveTextContent('valid checkout customer')
  expect(createOrder).not.toHaveBeenCalled()
})

test('missing items are blocked before the order API request', async () => {
  render(<CheckoutPage checkoutItems={[]} />, { wrapper: BrowserRouter })
  fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  expect(screen.getByRole('alert')).toHaveTextContent('At least one valid checkout item')
  expect(createOrder).not.toHaveBeenCalled()
})

test('invalid item quantity is blocked before the order API request', async () => {
  render(<CheckoutPage checkoutItems={[{ sku: 'payguard-demo-order', name: 'PayGuard demo order', quantity: 0, amount: 129900 }]} />, { wrapper: BrowserRouter })
  fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  expect(screen.getByRole('alert')).toHaveTextContent('positive whole-number quantity')
  expect(createOrder).not.toHaveBeenCalled()
})

test('checkout callback verifies then gets authoritative status without directly showing success', async () => {
  createOrder.mockResolvedValueOnce({ paymentId: 'payment-local', orderNumber: 'PG-1', razorpayOrderId: 'order_gateway', amount: 129900, currency: 'INR', razorpayKeyId: 'rzp_test_key' })
  verifyPayment.mockResolvedValueOnce({ paymentId: 'payment-local' }); getPaymentStatus.mockResolvedValueOnce({})
  open.mockImplementationOnce((options) => options.handler({ razorpay_payment_id: 'pay_gateway', razorpay_order_id: 'order_gateway', razorpay_signature: 'signature' }))
  render(<CheckoutPage />, { wrapper: BrowserRouter }); fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  await waitFor(() => expect(verifyPayment).toHaveBeenCalledWith(expect.objectContaining({ razorpay_payment_id: 'pay_gateway' })))
  expect(getPaymentStatus).toHaveBeenCalledWith('payment-local')
  expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
})

test('failed order creation does not open checkout or navigate to payment status', async () => {
  createOrder.mockRejectedValueOnce({ response: { status: 503, data: { error: { message: 'Test payment checkout is not configured.' } } } })
  render(<CheckoutPage />, { wrapper: BrowserRouter })
  fireEvent.click(screen.getByRole('button', { name: 'Pay securely' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  expect(open).not.toHaveBeenCalled()
  expect(getPaymentStatus).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Development order API diagnostic')).toHaveTextContent('Status: Failed')
  expect(screen.getByLabelText('Development order API diagnostic')).toHaveTextContent('HTTP status: 503')
})
