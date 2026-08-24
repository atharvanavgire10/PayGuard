const CARDS = [
  { key: 'totalPayments', label: 'Total payments' },
  { key: 'capturedPayments', label: 'Captured' },
  { key: 'pendingPayments', label: 'Pending' },
  { key: 'failedPayments', label: 'Failed' },
  { key: 'unknownPayments', label: 'Unknown' },
  { key: 'paidOrders', label: 'Paid orders' },
  { key: 'ordersRequiringAttention', label: 'Orders needing attention', tone: 'warning' },
  { key: 'duplicateWebhookEvents', label: 'Duplicate webhook events' },
  { key: 'failedWebhookEvents', label: 'Failed webhooks', tone: 'danger' },
]

export default function SummaryCards({ summary }) {
  if (!summary) return null
  return <section className="summary-grid" aria-label="Payment reliability summary">{CARDS.map(({ key, label, tone }) => <article key={key} className={`summary-card${tone && summary[key] > 0 ? ` summary-card--${tone}` : ''}`}><p className="summary-card__label">{label}</p><p className="summary-card__value">{summary[key] ?? 0}</p></article>)}</section>
}
