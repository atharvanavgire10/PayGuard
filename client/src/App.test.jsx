import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import App from './App.jsx'

test('renders the PayGuard foundation page', () => {
  render(<App />, { wrapper: BrowserRouter })
  expect(screen.getByRole('heading', { name: 'PayGuard' })).toBeInTheDocument()
})
