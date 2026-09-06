function formatActivityTime(value) {
  return new Date(value).toLocaleString()
}

export default function ReconciliationHealth({ summary }) {
  const activity = summary.lastReconciliationActivity
  const failures = summary.totalReconciliationFailures ?? 0
  const manualReview = summary.totalManualReview ?? 0
  const healthy = failures === 0 && manualReview === 0

  return <section className="panel" aria-label="Reconciliation health">
    <h2>Reconciliation health</h2>
    <p><strong>Health:</strong> {healthy ? 'Healthy — no reconciliation failures or manual-review cases.' : 'Attention required'}</p>
    {!activity ? <p className="empty-state">No reconciliation activity has been recorded yet.</p> : <>
      <div className="summary-grid">
        <article className="summary-card"><p className="summary-card__label">Auto-recovered</p><p className="summary-card__value">{summary.totalAutoRecovered ?? 0}</p></article>
        <article className="summary-card"><p className="summary-card__label">Manual review</p><p className="summary-card__value">{manualReview}</p></article>
        <article className={`summary-card${failures > 0 ? ' summary-card--danger' : ''}`}><p className="summary-card__label">Failures</p><p className="summary-card__value">{failures}</p></article>
      </div>
      <p><strong>Last activity:</strong> {activity.outcome === 'AUTO_RECOVERED' ? 'AUTO-RECOVERED' : activity.outcome === 'MANUAL_REVIEW' ? 'MANUAL REVIEW' : activity.outcome === 'WORKER_FAILURE' ? 'WORKER FAILURE' : 'RECONCILIATION FAILURE'} · {formatActivityTime(activity.occurredAt)}</p>
    </>}
  </section>
}
