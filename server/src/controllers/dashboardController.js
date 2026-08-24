import { getAttentionQueue, getDashboardSummary, getReconciliation, getRecentPayments } from '../services/payment/reconciliationService.js'

export async function getSummary(request, response, next) {
  try {
    response.status(200).json(await getDashboardSummary())
  } catch (error) { next(error) }
}

export async function getPayments(request, response, next) {
  try {
    response.status(200).json(await getRecentPayments({ limit: request.query.limit }))
  } catch (error) { next(error) }
}

export async function getAttention(request, response, next) {
  try {
    response.status(200).json(await getAttentionQueue({ limit: request.query.limit }))
  } catch (error) { next(error) }
}

export async function getPaymentReconciliation(request, response, next) {
  try {
    response.status(200).json(await getReconciliation(request.params.paymentId))
  } catch (error) { next(error) }
}
