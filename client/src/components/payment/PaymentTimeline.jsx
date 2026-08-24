const labels = { PAYMENT_CREATED: 'Payment initiated', PAYMENT_PENDING: 'Payment processing', PAYMENT_VERIFICATION_STARTED: 'Payment verification started', PAYMENT_AUTHORIZED: 'Payment authorized', PAYMENT_CAPTURED: 'Payment confirmed', PAYMENT_FAILED: 'Payment failed', PAYMENT_RECONCILIATION_STARTED: 'Payment recovery started', PAYMENT_RECONCILIATION_SUCCESS: 'Payment recovered', PAYMENT_RECONCILIATION_FAILED: 'Payment recovery needs review', ORDER_CREATED: 'Order created', DUPLICATE_PAYMENT_DETECTED: 'Duplicate payment detected' }

export default function PaymentTimeline({ events = [], paymentStatus, orderStatus }) {
  const paymentSucceeded = paymentStatus === 'CAPTURED' && orderStatus === 'PAID'
  return <section className="timeline" aria-label="Payment timeline"><h2>Payment timeline</h2>{paymentStatus && <p className="timeline__current">Current status: <strong>{paymentStatus}</strong>{orderStatus && <> · Order: <strong>{orderStatus}</strong></>}</p>}{events.length === 0 ? <p className="muted">No verified timeline events are available yet.</p> : <ol>{events.map((event) => {
    const completed = paymentSucceeded && event.type !== 'PAYMENT_FAILED' && event.status !== 'failed'
    return <li className={completed ? 'timeline__event--completed' : ''} key={`${event.type}-${event.timestamp}`}><span className="timeline__marker" aria-hidden="true">{completed ? '✓' : event.status === 'failed' ? '!' : '•'}</span><div><strong>{labels[event.type] || event.type}</strong><span>{new Date(event.timestamp).toLocaleString()} · {completed ? 'Completed' : event.status}</span></div></li>
  })}</ol>}</section>
}
