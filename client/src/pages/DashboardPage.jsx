import { useDashboard } from '../hooks/useDashboard.js'
import AttentionQueue from '../components/dashboard/AttentionQueue.jsx'
import RecentPaymentsTable from '../components/dashboard/RecentPaymentsTable.jsx'
import ReconciliationHealth from '../components/dashboard/ReconciliationHealth.jsx'
import SummaryCards from '../components/dashboard/SummaryCards.jsx'

// The backend and database stay authoritative: this page only renders what they report.
export default function DashboardPage() {
  const { data, error, loading, reload } = useDashboard()
  return <main className="dashboard"><header><p className="eyebrow">Development only</p><h1>Payment reliability dashboard</h1><p>Read-only reconciliation view of authoritative PayGuard data. This dashboard never changes payment state.</p><button type="button" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></header>{loading && !data && <section className="panel" aria-busy="true"><div className="spinner" role="status" aria-label="Loading dashboard data" /><p className="muted">Loading reconciliation data…</p></section>}{error && <section className="error-state" role="alert"><h2>Dashboard unavailable</h2><p>{error}</p></section>}{data && <><SummaryCards summary={data.summary} /><ReconciliationHealth summary={data.summary} /><AttentionQueue items={data.attention} thresholdMinutes={data.thresholdMinutes} /><RecentPaymentsTable payments={data.payments} /></>}</main>
}
