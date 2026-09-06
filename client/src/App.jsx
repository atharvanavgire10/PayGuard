import { Route, Routes, useNavigate } from 'react-router-dom'
import './App.css'
import CheckoutPage from './pages/CheckoutPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import PaymentStatusPage from './pages/PaymentStatusPage.jsx'

function FoundationPage() {
  const navigate = useNavigate()

  return (
    <main className="foundation-page">
      <p className="eyebrow">Payment reliability infrastructure</p>
      <h1>PayGuard</h1>
      <p>
        The project foundation is ready. Payment processing and recovery workflows
        will be added in later phases.
      </p>
      <div className="actions">
        <button type="button" onClick={() => navigate('/checkout')}>
          Go to Checkout
        </button>
      </div>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<FoundationPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/payment/processing" element={<PaymentStatusPage />} />
      <Route path="/payment/review" element={<PaymentStatusPage />} />
      <Route path="/payment/success" element={<PaymentStatusPage />} />
      <Route path="/payment/failed" element={<PaymentStatusPage />} />
      <Route path="*" element={<FoundationPage />} />
    </Routes>
  )
}

export default App
