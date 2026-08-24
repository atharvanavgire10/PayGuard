import { formatAmount } from '../payment/PaymentProcessing.jsx'
import StatusBadge from './StatusBadge.jsx'

const when = (value) => (value ? new Date(value).toLocaleString() : '—')

export default function RecentPaymentsTable({ payments }) {
  if (payments.length === 0) return <section className="panel"><h2>Recent payment activity</h2><p className="empty-state">No payments have been recorded yet. Complete a checkout to see activity here.</p></section>
  return <section className="panel"><h2>Recent payment activity</h2><div className="table-scroll"><table className="data-table"><caption className="visually-hidden">Recent payments with their order and payment status</caption><thead><tr><th scope="col">Order</th><th scope="col">Payment ID</th><th scope="col">Razorpay payment</th><th scope="col">Amount</th><th scope="col">Payment status</th><th scope="col">Order status</th><th scope="col">Created</th><th scope="col">Updated</th></tr></thead><tbody>{payments.map((row) => <tr key={row.paymentId}><td>{row.orderNumber || '—'}</td><td className="mono">{row.paymentId}</td><td className="mono">{row.razorpayPaymentId || '—'}</td><td>{formatAmount(row.amount, row.currency)}</td><td><StatusBadge status={row.paymentStatus} /></td><td><StatusBadge status={row.orderStatus} /></td><td>{when(row.createdAt)}</td><td>{when(row.updatedAt)}</td></tr>)}</tbody></table></div></section>
}
