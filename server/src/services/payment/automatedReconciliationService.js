import Order from '../../models/Order.js'
import Payment from '../../models/Payment.js'
import PaymentEvent from '../../models/PaymentEvent.js'
import { assertOrderTransition } from './stateTransitionService.js'

const AUDIT_STATUS = Object.freeze({ COMPLETED: 'completed', PENDING: 'pending' })

async function recordOnce({ paymentId, orderId, type, status }) {
  const existing = await PaymentEvent.findOne({ paymentId, type })
  if (existing) return false
  await PaymentEvent.create({ paymentId, orderId, type, status })
  return true
}

async function markManualReview(payment, order, result) {
  const created = await recordOnce({ paymentId: payment._id, orderId: order?._id || payment.orderId, type: 'MANUAL_REVIEW_REQUIRED', status: AUDIT_STATUS.PENDING })
  result.manualReview += 1
  if (created) result.eventsCreated += 1
}

async function recordReconciliationFailure(payment, result) {
  try {
    const created = await recordOnce({ paymentId: payment._id, orderId: payment.orderId, type: 'PAYMENT_RECONCILIATION_FAILED', status: 'failed' })
    if (created) result.eventsCreated += 1
  } catch {
    // The original failure is still reported in the run result; audit write failure must not stop scanning.
  }
}

export async function runAutomatedReconciliation() {
  const payments = await Payment.find({ status: { $in: ['CAPTURED', 'PENDING', 'UNKNOWN'] } }).sort({ updatedAt: 1 })
  const result = { scanned: payments.length, repaired: 0, manualReview: 0, unchanged: 0, eventsCreated: 0, failures: [] }

  for (const payment of payments) {
    try {
      const order = await Order.findById(payment.orderId)
      if (!order) { await markManualReview(payment, null, result); continue }
      if (payment.status === 'CAPTURED' && order.status !== 'PAID') {
        try {
          assertOrderTransition(order.status, 'PAID')
          const started = await recordOnce({ paymentId: payment._id, orderId: order._id, type: 'RECONCILIATION_STARTED', status: AUDIT_STATUS.COMPLETED })
          order.status = 'PAID'; order.paymentStatus = 'CAPTURED'; await order.save()
          const repaired = await recordOnce({ paymentId: payment._id, orderId: order._id, type: 'ORDER_REPAIRED', status: AUDIT_STATUS.COMPLETED })
          result.repaired += 1; result.eventsCreated += Number(started) + Number(repaired)
        } catch {
          await markManualReview(payment, order, result)
        }
      } else if (payment.status === 'PENDING' || payment.status === 'UNKNOWN') {
        await markManualReview(payment, order, result)
      } else {
        result.unchanged += 1
      }
    } catch (error) {
      result.failures.push({ paymentId: payment._id.toString(), message: 'Reconciliation could not process this payment.' })
      await recordReconciliationFailure(payment, result)
    }
  }
  return result
}
