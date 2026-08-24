export default function PaymentStatusCard({ title, message, children, tone = 'neutral' }) {
  return <section className={`status-card status-card--${tone}`} aria-live="polite"><div className="status-card__icon" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'danger' ? '!' : '•'}</div><div><h1>{title}</h1><p>{message}</p>{children}</div></section>
}
