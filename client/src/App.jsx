import { Route, Routes } from 'react-router-dom'
import './App.css'
import CheckoutPage from './pages/CheckoutPage.jsx'
import PaymentStatusPage from './pages/PaymentStatusPage.jsx'

function FoundationPage() {
  return (
    <main className="foundation-page">
      <p className="eyebrow">Payment reliability infrastructure</p>
      <h1>PayGuard</h1>
      <p>
        The project foundation is ready. Payment processing and recovery workflows
        will be added in later phases.
      </p>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/payment/processing" element={<PaymentStatusPage />} />
      <Route path="/payment/review" element={<PaymentStatusPage />} />
      <Route path="/payment/success" element={<PaymentStatusPage />} />
      <Route path="/payment/failed" element={<PaymentStatusPage />} />
      <Route path="*" element={<FoundationPage />} />
    </Routes>
  )
}

export default App
