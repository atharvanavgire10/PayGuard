import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePaymentStatus } from '../hooks/usePaymentStatus.js'
import PaymentProcessing from '../components/payment/PaymentProcessing.jsx'
import PaymentReview from '../components/payment/PaymentReview.jsx'
import PaymentSuccess from '../components/payment/PaymentSuccess.jsx'
import PaymentFailed from '../components/payment/PaymentFailed.jsx'
import PaymentTimeline from '../components/payment/PaymentTimeline.jsx'
import DuplicatePaymentAlert from '../components/payment/DuplicatePaymentAlert.jsx'

function ReferenceForm({ onSubmit, loading }) {
  const [type, setType] = useState('payment'); const [id, setId] = useState('')
  return <form className="reference-form" onSubmit={(event) => { event.preventDefault(); if (id.trim()) onSubmit(type, id.trim()) }}><label>Lookup type<select value={type} onChange={(event) => setType(event.target.value)}><option value="payment">Payment ID</option><option value="order">Order ID</option></select></label><label>Reference ID<input required value={id} onChange={(event) => setId(event.target.value)} placeholder="MongoDB payment or order ID" /></label><button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Check status'}</button></form>
}

function StatusResult({ data, loading, timedOut, onCheck }) {
  const { payment, order, timeline } = data
  const review = ['UNKNOWN', 'PENDING'].includes(payment.status) || order.status === 'PAYMENT_REVIEW'
  const success = payment.status === 'CAPTURED' || order.status === 'PAID'
  const failed = payment.status === 'FAILED'
  return <><DuplicatePaymentAlert timeline={timeline} />{review ? <PaymentReview payment={payment} order={order} onCheck={onCheck} loading={loading} timedOut={timedOut} /> : success ? <PaymentSuccess payment={payment} order={order} /> : failed ? <PaymentFailed payment={payment} order={order} /> : <PaymentProcessing payment={payment} />}<PaymentTimeline events={timeline} paymentStatus={payment.status} orderStatus={order.status} /></>
}

export default function PaymentStatusPage() {
  const { statusData, error, loading, timedOut, checkStatus } = usePaymentStatus()
  const location = useLocation()
  useEffect(() => { const reference = location.state?.reference; if (reference?.id && reference?.type) checkStatus(reference.type, reference.id) }, [checkStatus, location.state])
  return <main className="payment-page"><header><p className="eyebrow">PayGuard payment recovery</p><h1>Payment status</h1><p>Use a payment or order reference to retrieve the authoritative status from PayGuard.</p></header><ReferenceForm onSubmit={checkStatus} loading={loading} />{error && <section className="error-state" role="alert"><h2>We couldn’t check your payment</h2><p>{error}</p></section>}{!statusData && !error && <PaymentProcessing />}{statusData && <StatusResult data={statusData} loading={loading} timedOut={timedOut} onCheck={() => checkStatus('payment', statusData.payment.id)} />}</main>
}
