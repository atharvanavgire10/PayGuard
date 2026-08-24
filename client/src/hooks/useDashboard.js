import { useCallback, useEffect, useState } from 'react'
import { getDashboardAttention, getDashboardPayments, getDashboardSummary, toSafeDashboardError } from '../services/api.js'

// Read-only: the dashboard reports what the backend already decided and never derives payment outcomes.
export function useDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [summary, recent, attention] = await Promise.all([getDashboardSummary(), getDashboardPayments(), getDashboardAttention()])
      setData({ summary, payments: recent.payments || [], attention: attention.items || [], thresholdMinutes: attention.thresholdMinutes })
    } catch (requestError) { setError(toSafeDashboardError(requestError)); setData(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  return { data, error, loading, reload: load }
}
