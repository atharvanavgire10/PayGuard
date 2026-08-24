const TONES = {
  CAPTURED: 'success', PAID: 'success',
  FAILED: 'danger', PAYMENT_FAILED: 'danger',
  UNKNOWN: 'warning', PAYMENT_REVIEW: 'warning', PENDING: 'warning',
  CREATED: 'neutral', PENDING_PAYMENT: 'neutral', REFUNDED: 'neutral', CANCELLED: 'neutral',
}

export default function StatusBadge({ status, label }) {
  if (!status) return <span className="badge badge--neutral">—</span>
  return <span className={`badge badge--${TONES[status] || 'neutral'}`}>{label ? `${label}: ${status}` : status}</span>
}
