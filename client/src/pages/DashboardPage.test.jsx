import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import DashboardPage from './DashboardPage.jsx'

vi.mock('../services/api.js', () => ({
  getDashboardSummary: vi.fn(), getDashboardPayments: vi.fn(), getDashboardAttention: vi.fn(),
  toSafeDashboardError: (error) => (error?.response?.status === 404 ? 'The reliability dashboard is only available in development.' : 'Dashboard data is temporarily unavailable. Please try again shortly.'),
}))
import { getDashboardAttention, getDashboardPayments, getDashboardSummary } from '../services/api.js'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const summary = { totalPayments: 4, capturedPayments: 1, pendingPayments: 1, failedPayments: 1, unknownPayments: 1, paidOrders: 1, ordersRequiringAttention: 1, duplicateWebhookEvents: 2, failedWebhookEvents: 1, totalAutoRecovered: 2, totalManualReview: 1, lastReconciliationActivity: { outcome: 'AUTO_RECOVERED', occurredAt: '2026-08-24T10:00:00.000Z' } }
const paymentRow = { paymentId: '507f1f77bcf86cd799439011', orderNumber: 'PG-100', razorpayPaymentId: 'pay_test', amount: 129900, currency: 'INR', paymentStatus: 'CAPTURED', orderStatus: 'PAID', createdAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:01:00.000Z' }

function mockApi({ summaryData = summary, payments = [paymentRow], attention = [], thresholdMinutes = 15 } = {}) {
  getDashboardSummary.mockResolvedValue(summaryData)
  getDashboardPayments.mockResolvedValue({ payments })
  getDashboardAttention.mockResolvedValue({ items: attention, thresholdMinutes })
}

test('renders summary cards and the recent payments table from authoritative data', async () => {
  mockApi()
  render(<DashboardPage />)
  expect(await screen.findByRole('heading', { name: 'Payment reliability dashboard' })).toBeInTheDocument()
  const summarySection = screen.getByLabelText('Payment reliability summary')
  expect(within(summarySection).getByText('Total payments')).toBeInTheDocument()
  expect(within(summarySection).getByText('4')).toBeInTheDocument()
  expect(within(summarySection).getByText('Duplicate webhook events')).toBeInTheDocument()
  expect(screen.getByText('PG-100')).toBeInTheDocument()
  expect(screen.getByText('pay_test')).toBeInTheDocument()
  expect(screen.getByText('₹1,299.00')).toBeInTheDocument()
})

test('shows a loading state before data arrives', async () => {
  getDashboardSummary.mockReturnValue(new Promise(() => {}))
  getDashboardPayments.mockReturnValue(new Promise(() => {}))
  getDashboardAttention.mockReturnValue(new Promise(() => {}))
  render(<DashboardPage />)
  expect(screen.getByRole('status', { name: 'Loading dashboard data' })).toBeInTheDocument()
  expect(screen.getByText('Loading reconciliation data…')).toBeInTheDocument()
})

test('shows empty states when there is no activity and nothing needs attention', async () => {
  mockApi({ summaryData: { ...summary, totalAutoRecovered: 0, totalManualReview: 0, lastReconciliationActivity: null }, payments: [], attention: [] })
  render(<DashboardPage />)
  expect(await screen.findByText(/No payments have been recorded yet/)).toBeInTheDocument()
  expect(screen.getByText(/Nothing needs attention/)).toBeInTheDocument()
  expect(screen.getByText(/No reconciliation activity has been recorded yet/)).toBeInTheDocument()
})

test('shows reconciliation totals and the most recent authoritative activity', async () => {
  mockApi()
  render(<DashboardPage />)
  const health = await screen.findByLabelText('Reconciliation health')
  expect(within(health).getByText('Auto-recovered')).toBeInTheDocument()
  expect(within(health).getByText('Manual review')).toBeInTheDocument()
  expect(within(health).getByText(/Last activity:/).parentElement).toHaveTextContent('AUTO-RECOVERED')
})

test('lists attention records with their database-derived reasons', async () => {
  mockApi({ attention: [{ kind: 'PAYMENT', paymentId: 'p1', orderNumber: 'PG-201', amount: 129900, currency: 'INR', paymentStatus: 'UNKNOWN', orderStatus: 'PAYMENT_REVIEW', updatedAt: '2026-08-24T10:00:00.000Z', reasons: ['UNKNOWN_PAYMENT', 'ORDER_UNDER_REVIEW'], mismatch: false }] })
  render(<DashboardPage />)
  expect(await screen.findByText('PG-201')).toBeInTheDocument()
  expect(screen.getByText('Payment state unknown')).toBeInTheDocument()
  expect(screen.getByText('Order under review')).toBeInTheDocument()
  expect(screen.getByText('Payment: UNKNOWN')).toBeInTheDocument()
  expect(screen.getByText('Order: PAYMENT_REVIEW')).toBeInTheDocument()
  expect(screen.queryByText('State mismatch')).not.toBeInTheDocument()
})

test('marks a payment/order state mismatch explicitly', async () => {
  mockApi({ attention: [{ kind: 'PAYMENT', paymentId: 'p2', orderNumber: 'PG-202', amount: 129900, currency: 'INR', paymentStatus: 'CAPTURED', orderStatus: 'PENDING_PAYMENT', updatedAt: '2026-08-24T10:00:00.000Z', reasons: ['CAPTURED_ORDER_NOT_PAID'], mismatch: true }] })
  render(<DashboardPage />)
  expect(await screen.findByText('State mismatch')).toBeInTheDocument()
  expect(screen.getByText('Captured but order not paid')).toBeInTheDocument()
})

test('surfaces a failed webhook entry in the attention queue', async () => {
  mockApi({ attention: [{ kind: 'WEBHOOK', eventId: 'evt_1', eventType: 'payment.captured', error: 'Matching payment was not found.', receivedAt: '2026-08-24T10:00:00.000Z', reasons: ['WEBHOOK_PROCESSING_FAILED'], mismatch: false }] })
  render(<DashboardPage />)
  expect(await screen.findByText('evt_1')).toBeInTheDocument()
  expect(screen.getByText('Webhook failed')).toBeInTheDocument()
  expect(screen.getByText('Matching payment was not found.')).toBeInTheDocument()
})

test('renders a safe error state when the API fails', async () => {
  getDashboardSummary.mockRejectedValue(new Error('network'))
  getDashboardPayments.mockRejectedValue(new Error('network'))
  getDashboardAttention.mockRejectedValue(new Error('network'))
  render(<DashboardPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard data is temporarily unavailable')
  expect(screen.queryByLabelText('Payment reliability summary')).not.toBeInTheDocument()
})

test('explains that the dashboard is development-only when the server hides it', async () => {
  const notFound = Object.assign(new Error('not found'), { response: { status: 404 } })
  getDashboardSummary.mockRejectedValue(notFound)
  getDashboardPayments.mockRejectedValue(notFound)
  getDashboardAttention.mockRejectedValue(notFound)
  render(<DashboardPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('only available in development')
})

test('never renders a payment outcome the backend did not report', async () => {
  mockApi({ payments: [{ ...paymentRow, paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT' }] })
  render(<DashboardPage />)
  await waitFor(() => expect(screen.getByText('PENDING')).toBeInTheDocument())
  expect(screen.queryByText('CAPTURED')).not.toBeInTheDocument()
  expect(screen.queryByText('PAID')).not.toBeInTheDocument()
})
