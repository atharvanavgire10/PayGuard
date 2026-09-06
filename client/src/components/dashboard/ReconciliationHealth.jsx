function formatActivityTime(value) {
  return new Date(value).toLocaleString()
}

export default function ReconciliationHealth({ summary }) {
  const activity = summary.lastReconciliationActivity

  return <section className="panel" aria-label="Reconciliation health">
    <h2>Reconciliation health</h2>
    {!activity ? <p className="empty-state">No reconciliation activity has been recorded yet.</p> : <>
      <div className="summary-grid">
        <article className="summary-card"><p className="summary-card__label">Auto-recovered</p><p className="summary-card__value">{summary.totalAutoRecovered ?? 0}</p></article>
        <article className="summary-card"><p className="summary-card__label">Manual review</p><p className="summary-card__value">{summary.totalManualReview ?? 0}</p></article>
      </div>
      <p><strong>Last activity:</strong> {activity.outcome === 'AUTO_RECOVERED' ? 'AUTO-RECOVERED' : 'MANUAL REVIEW'} · {formatActivityTime(activity.occurredAt)}</p>
    </>}
  </section>
}
