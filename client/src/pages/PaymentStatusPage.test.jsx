import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import PaymentStatusPage from './PaymentStatusPage.jsx'

vi.mock('../services/api.js', () => ({ getPaymentStatus: vi.fn(), getOrderStatus: vi.fn(), toSafeApiError: () => 'We could not reach PayGuard. Your payment status is unchanged; please try again shortly.' }))
import { getPaymentStatus } from '../services/api.js'

afterEach(() => { cleanup(); vi.clearAllMocks() })

test('network error renders a safe error state', async () => {
  getPaymentStatus.mockRejectedValueOnce(new Error('network'))
  render(<PaymentStatusPage />, { wrapper: BrowserRouter })
  fireEvent.change(screen.getByPlaceholderText('MongoDB payment or order ID'), { target: { value: '507f1f77bcf86cd799439011' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach PayGuard')
})

test('manual status check uses the authoritative API', async () => {
  getPaymentStatus.mockResolvedValueOnce({ payment: { id: '507f1f77bcf86cd799439011', status: 'FAILED', amount: 100, currency: 'INR' }, order: { orderNumber: 'PG-1', status: 'PAYMENT_FAILED' }, timeline: [] })
  render(<PaymentStatusPage />, { wrapper: BrowserRouter })
  fireEvent.change(screen.getByPlaceholderText('MongoDB payment or order ID'), { target: { value: '507f1f77bcf86cd799439011' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
  await waitFor(() => expect(getPaymentStatus).toHaveBeenCalledWith('507f1f77bcf86cd799439011'))
  expect(await screen.findByText("Payment wasn't completed")).toBeInTheDocument()
})
