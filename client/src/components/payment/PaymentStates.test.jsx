import { cleanup, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import PaymentProcessing from './PaymentProcessing.jsx'
import PaymentReview from './PaymentReview.jsx'
import PaymentSuccess from './PaymentSuccess.jsx'
import PaymentFailed from './PaymentFailed.jsx'
import DuplicatePaymentAlert from './DuplicatePaymentAlert.jsx'
import PaymentTimeline from './PaymentTimeline.jsx'

const payment = { id: 'payment-id', status: 'UNKNOWN', amount: 129900, currency: 'INR', razorpayOrderId: 'order_gateway', razorpayPaymentId: 'pay_gateway', updatedAt: '2026-01-02T03:04:05.000Z' }
const order = { orderNumber: 'PG-100', status: 'PAYMENT_REVIEW', paymentStatus: 'UNKNOWN' }
afterEach(cleanup)

test('processing state renders', () => { render(<PaymentProcessing payment={payment} />); expect(screen.getByRole('heading', { name: 'Verifying your payment...' })).toBeInTheDocument() })
test('unknown payment has recovery copy and no pay again action', () => { render(<PaymentReview payment={payment} order={order} onCheck={() => {}} />); expect(screen.getByText("Please don't pay again.")).toBeInTheDocument(); expect(screen.queryByText('Pay Again')).not.toBeInTheDocument() })
test('captured payment renders success', () => { render(<PaymentSuccess payment={{ ...payment, status: 'CAPTURED' }} order={{ ...order, status: 'PAID' }} />, { wrapper: BrowserRouter }); expect(screen.getByText('Payment confirmed')).toBeInTheDocument() })
test('failed payment renders failure', () => { render(<PaymentFailed payment={{ ...payment, status: 'FAILED' }} order={order} />, { wrapper: BrowserRouter }); expect(screen.getByText("Payment wasn't completed")).toBeInTheDocument() })
test('duplicate payment warning appears only from a backend event', () => { render(<DuplicatePaymentAlert timeline={[{ type: 'DUPLICATE_PAYMENT_DETECTED' }]} />); expect(screen.getByRole('alert')).toHaveTextContent('Duplicate payment detected') })
test('timeline renders only backend-provided events', () => { render(<PaymentTimeline events={[{ type: 'PAYMENT_CREATED', status: 'completed', timestamp: '2026-01-02T03:04:05.000Z' }]} />); expect(screen.getByText('Payment initiated')).toBeInTheDocument(); expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument() })
test('successful payment marks historical pending events completed and shows authoritative current state', () => {
  render(<PaymentTimeline paymentStatus="CAPTURED" orderStatus="PAID" events={[{ type: 'PAYMENT_CREATED', status: 'completed', timestamp: '2026-01-02T03:04:05.000Z' }, { type: 'PAYMENT_PENDING', status: 'pending', timestamp: '2026-01-02T03:05:05.000Z' }, { type: 'ORDER_CREATED', status: 'completed', timestamp: '2026-01-02T03:06:05.000Z' }, { type: 'PAYMENT_CAPTURED', status: 'completed', timestamp: '2026-01-02T03:07:05.000Z' }]} />)
  expect(screen.getByText(/Current status:/)).toHaveTextContent('CAPTURED')
  expect(screen.getByText('Payment processing').parentElement).toHaveTextContent('Completed')
  expect(screen.getByText('Payment processing').parentElement).not.toHaveTextContent('pending')
  expect(screen.getByText('Order created')).toBeInTheDocument()
  expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
})
