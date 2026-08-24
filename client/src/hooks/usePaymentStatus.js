import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrderStatus, getPaymentStatus, toSafeApiError } from '../services/api.js'

const TERMINAL = new Set(['CAPTURED', 'FAILED', 'REFUNDED'])

export function usePaymentStatus({ maxAttempts = 8, intervalMs = 5000 } = {}) {
  const [statusData, setStatusData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const reference = useRef(null)
  const timer = useRef(null)
  const attempts = useRef(0)

  const stopPolling = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null }, [])
  const request = useCallback(async () => {
    if (!reference.current) return
    setLoading(true); setError('')
    try {
      const result = reference.current.type === 'order' ? await getOrderStatus(reference.current.id) : await getPaymentStatus(reference.current.id)
      setStatusData(result)
      return result
    } catch (requestError) { setError(toSafeApiError(requestError)); return null }
    finally { setLoading(false) }
  }, [])

  const schedulePolling = useCallback(() => {
    stopPolling()
    const poll = async () => {
      const result = await request()
      const paymentStatus = result?.payment?.status
      const underReview = result?.order?.status === 'PAYMENT_REVIEW'
      if (!result || TERMINAL.has(paymentStatus) || (!['UNKNOWN', 'PENDING'].includes(paymentStatus) && !underReview)) return
      attempts.current += 1
      if (attempts.current >= maxAttempts) { setTimedOut(true); return }
      timer.current = setTimeout(poll, intervalMs)
    }
    timer.current = setTimeout(poll, intervalMs)
  }, [intervalMs, maxAttempts, request, stopPolling])

  const checkStatus = useCallback(async (type, id) => {
    stopPolling(); attempts.current = 0; setTimedOut(false); reference.current = { type, id }
    const result = await request()
    const needsPolling = result && (['UNKNOWN', 'PENDING'].includes(result.payment.status) || result.order.status === 'PAYMENT_REVIEW')
    if (needsPolling) schedulePolling()
  }, [request, schedulePolling, stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])
  return { statusData, error, loading, timedOut, checkStatus, stopPolling }
}
