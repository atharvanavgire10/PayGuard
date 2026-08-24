import { formatAmount } from '../payment/PaymentProcessing.jsx'
import StatusBadge from './StatusBadge.jsx'
import { reasonLabel } from './reasonLabels.js'

const when = (value) => (value ? new Date(value).toLocaleString() : '—')

function PaymentEntry({ item }) {
  return <li className={`attention-item${item.mismatch ? ' attention-item--mismatch' : ''}`}><div className="attention-item__head"><span className="mono">{item.orderNumber || item.paymentId}</span>{item.mismatch && <span className="badge badge--danger" title="Stored payment and order state disagree">State mismatch</span>}</div><p className="muted">{formatAmount(item.amount, item.currency)} · updated {when(item.updatedAt)}</p><p className="attention-item__states"><StatusBadge status={item.paymentStatus} label="Payment" /> <StatusBadge status={item.orderStatus} label="Order" /></p><ul className="reason-list">{item.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul></li>
}

function WebhookEntry({ item }) {
  return <li className="attention-item attention-item--webhook"><div className="attention-item__head"><span className="mono">{item.eventId}</span><span className="badge badge--danger">Webhook failed</span></div><p className="muted">{item.eventType} · received {when(item.receivedAt)}</p>{item.error && <p className="attention-item__error">{item.error}</p>}<ul className="reason-list">{item.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul></li>
}

export default function AttentionQueue({ items, thresholdMinutes }) {
  return <section className="panel"><h2>Attention queue</h2><p className="muted">Every entry below is derived from stored PayGuard state. Pending payments are listed after {thresholdMinutes ?? 15} minutes.</p>{items.length === 0 ? <p className="empty-state">Nothing needs attention. No unknown payments, stale pending payments, state mismatches, or webhook failures were found.</p> : <ul className="attention-list">{items.map((item) => item.kind === 'WEBHOOK' ? <WebhookEntry key={item.eventId} item={item} /> : <PaymentEntry key={item.paymentId} item={item} />)}</ul>}</section>
}
