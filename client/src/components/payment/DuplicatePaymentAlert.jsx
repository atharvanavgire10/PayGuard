export default function DuplicatePaymentAlert({ timeline = [] }) {
  if (!timeline.some((event) => event.type === 'DUPLICATE_PAYMENT_DETECTED')) return null
  return <aside className="duplicate-alert" role="alert"><strong>Duplicate payment detected</strong><p>We detected a duplicate payment attempt and prevented a second order.</p></aside>
}
