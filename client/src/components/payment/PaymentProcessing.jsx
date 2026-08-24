import PaymentStatusCard from './PaymentStatusCard.jsx'
export default function PaymentProcessing({ payment }) {
  return <PaymentStatusCard title="Verifying your payment..." message="We are checking the authoritative payment status. Please wait before making another payment."><div className="spinner" aria-label="Payment verification loading" role="status" />{payment && <p className="detail-line">Amount: {formatAmount(payment.amount, payment.currency)} · Reference: {payment.razorpayPaymentId || payment.id}</p>}</PaymentStatusCard>
}
export function formatAmount(amount, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100) }
