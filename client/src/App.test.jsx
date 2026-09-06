import { render, screen } from '@testing-library/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { afterEach, expect, test } from 'vitest'
import App from './App.jsx'

test('renders the PayGuard foundation page', () => {
afterEach(() => { cleanup() })

test('renders the PayGuard foundation page with Go to Checkout CTA', () => {
  window.history.pushState({}, '', '/')
  render(<App />, { wrapper: BrowserRouter })
  expect(screen.getByRole('heading', { name: 'PayGuard' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to Checkout' })).toBeInTheDocument()
})

test('navigates to checkout when clicking Go to Checkout', () => {
  window.history.pushState({}, '', '/')
  render(<App />, { wrapper: BrowserRouter })
  const checkoutButton = screen.getByRole('button', { name: 'Go to Checkout' })
  fireEvent.click(checkoutButton)
  expect(screen.getByRole('heading', { name: 'Review your order' })).toBeInTheDocument()
})

