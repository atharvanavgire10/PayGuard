import mongoose from 'mongoose'
import Order from '../../models/Order.js'
import Payment from '../../models/Payment.js'
import PaymentEvent from '../../models/PaymentEvent.js'
import WebhookEvent from '../../models/WebhookEvent.js'
import { AppError } from '../../utils/AppError.js'

// Phase 14 is observability only: every value below is read from stored PayGuard state.
// Nothing here writes, transitions, or contacts Razorpay.
export const STALE_PENDING_MINUTES = () => Number(process.env.DASHBOARD_PENDING_MINUTES) || 15
const RECENT_LIMIT = 20
const SCAN_LIMIT = 200
const SETTLED = new Set(['CAPTURED', 'FAILED', 'REFUNDED'])

export const REASONS = Object.freeze({
  UNKNOWN_PAYMENT: 'UNKNOWN_PAYMENT', ORDER_UNDER_REVIEW: 'ORDER_UNDER_REVIEW', STALE_PENDING_PAYMENT: 'STALE_PENDING_PAYMENT',
  CAPTURED_ORDER_NOT_PAID: 'CAPTURED_ORDER_NOT_PAID', PAID_ORDER_NOT_CAPTURED: 'PAID_ORDER_NOT_CAPTURED',
  ORDER_PAYMENT_STATUS_DRIFT: 'ORDER_PAYMENT_STATUS_DRIFT', ORDER_MISSING: 'ORDER_MISSING', WEBHOOK_PROCESSING_FAILED: 'WEBHOOK_PROCESSING_FAILED',
})

const clampLimit = (value, fallback) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : fallback }

function assertObjectId(id, entity) { if (!mongoose.isObjectIdOrHexString(id)) throw new AppError(400, `Invalid ${entity} identifier.`) }

// Only settled contradictions count as mismatches. A freshly created order legitimately carries
// paymentStatus CREATED while its payment is PENDING, so drift is judged once the payment settles.
export function detectMismatch(payment, order) {
  const reasons = []
  if (!order) return { consistent: false, reasons: [REASONS.ORDER_MISSING] }
  if (payment.status === 'CAPTURED' && order.status !== 'PAID') reasons.push(REASONS.CAPTURED_ORDER_NOT_PAID)
  if (order.status === 'PAID' && payment.status !== 'CAPTURED') reasons.push(REASONS.PAID_ORDER_NOT_CAPTURED)
  if (SETTLED.has(payment.status) && order.paymentStatus !== payment.status) reasons.push(REASONS.ORDER_PAYMENT_STATUS_DRIFT)
  return { consistent: reasons.length === 0, reasons }
}

export function isStalePending(payment, now = Date.now(), minutes = STALE_PENDING_MINUTES()) {
  if (payment.status !== 'PENDING') return false
  const createdAt = new Date(payment.createdAt || 0).getTime()
  return Number.isFinite(createdAt) && createdAt > 0 && now - createdAt > minutes * 60 * 1000
}

// Never expose credentials, card data, or raw gateway payloads — only the identifiers a merchant needs.
function toPaymentRow(payment, order) {
  return {
    paymentId: payment._id.toString(), orderId: (order?._id || payment.orderId)?.toString(), orderNumber: order?.orderNumber || null,
    razorpayPaymentId: payment.razorpayPaymentId || null, razorpayOrderId: payment.razorpayOrderId || null,
    amount: payment.amount, currency: payment.currency, method: payment.method || null,
    paymentStatus: payment.status, orderStatus: order?.status || null, orderPaymentStatus: order?.paymentStatus || null,
    createdAt: payment.createdAt, updatedAt: payment.updatedAt, capturedAt: payment.capturedAt || null,
  }
}

async function ordersFor(payments) {
  const ids = [...new Set(payments.map((payment) => payment.orderId?.toString()).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const orders = await Order.find({ _id: { $in: ids } }).lean()
  return new Map(orders.map((order) => [order._id.toString(), order]))
}

export async function getDashboardSummary() {
  const [totalPayments, capturedPayments, pendingPayments, failedPayments, unknownPayments, paidOrders, ordersRequiringAttention, failedWebhookEvents, webhookEventsWithPayment, distinctWebhookPayments] = await Promise.all([
    Payment.countDocuments({}), Payment.countDocuments({ status: 'CAPTURED' }), Payment.countDocuments({ status: 'PENDING' }),
    Payment.countDocuments({ status: 'FAILED' }), Payment.countDocuments({ status: 'UNKNOWN' }),
    Order.countDocuments({ status: 'PAID' }), Order.countDocuments({ status: 'PAYMENT_REVIEW' }),
    WebhookEvent.countDocuments({ status: 'FAILED' }), WebhookEvent.countDocuments({ 'payload.paymentId': { $nin: [null, undefined] } }),
    WebhookEvent.distinct('payload.paymentId', { 'payload.paymentId': { $nin: [null, undefined] } }),
  ])
  // Phase 12 suppresses same-event-id redeliveries without storing them, so the only duplicate signal
  // in the database is one gateway payment arriving under more than one event id.
  const duplicateWebhookEvents = Math.max(0, webhookEventsWithPayment - (distinctWebhookPayments?.length || 0))
  return { totalPayments, capturedPayments, pendingPayments, failedPayments, unknownPayments, paidOrders, ordersRequiringAttention, duplicateWebhookEvents, failedWebhookEvents }
}

export async function getRecentPayments({ limit } = {}) {
  const payments = await Payment.find({}).sort({ createdAt: -1 }).limit(clampLimit(limit, RECENT_LIMIT)).lean()
  const orders = await ordersFor(payments)
  return { payments: payments.map((payment) => toPaymentRow(payment, orders.get(payment.orderId?.toString()))) }
}

export async function getAttentionQueue({ limit } = {}) {
  const thresholdMinutes = STALE_PENDING_MINUTES(); const now = Date.now()
  const scanned = await Payment.find({}).sort({ updatedAt: -1 }).limit(SCAN_LIMIT).lean()
  const orders = await ordersFor(scanned)
  const items = []
  for (const payment of scanned) {
    const order = orders.get(payment.orderId?.toString())
    const mismatch = detectMismatch(payment, order)
    const reasons = []
    if (payment.status === 'UNKNOWN') reasons.push(REASONS.UNKNOWN_PAYMENT)
    if (order?.status === 'PAYMENT_REVIEW') reasons.push(REASONS.ORDER_UNDER_REVIEW)
    if (isStalePending(payment, now, thresholdMinutes)) reasons.push(REASONS.STALE_PENDING_PAYMENT)
    reasons.push(...mismatch.reasons)
    if (reasons.length > 0) items.push({ kind: 'PAYMENT', ...toPaymentRow(payment, order), reasons: [...new Set(reasons)], mismatch: !mismatch.consistent })
  }
  const failed = await WebhookEvent.find({ status: 'FAILED' }).sort({ createdAt: -1 }).limit(clampLimit(limit, RECENT_LIMIT)).lean()
  const webhooks = failed.map((event) => ({
    kind: 'WEBHOOK', eventId: event.eventId, eventType: event.eventType, error: event.error || null,
    razorpayPaymentId: event.payload?.paymentId || null, razorpayOrderId: event.payload?.orderId || null,
    receivedAt: event.createdAt, reasons: [REASONS.WEBHOOK_PROCESSING_FAILED], mismatch: false,
  }))
  return { thresholdMinutes, scannedPayments: scanned.length, items: [...items, ...webhooks] }
}

export async function getReconciliation(paymentId) {
  assertObjectId(paymentId, 'payment')
  const payment = await Payment.findById(paymentId).lean()
  if (!payment) throw new AppError(404, 'Payment not found.')
  const order = await Order.findById(payment.orderId).lean()
  const mismatch = detectMismatch(payment, order)
  const events = await PaymentEvent.find({ paymentId: payment._id }).sort({ occurredAt: 1 }).lean()
  const gatewayReference = payment.razorpayPaymentId || null
  const webhookQuery = gatewayReference ? { 'payload.paymentId': gatewayReference } : { 'payload.orderId': payment.razorpayOrderId }
  const webhookEvents = await WebhookEvent.find(webhookQuery).sort({ createdAt: 1 }).lean()
  return {
    source: 'payguard-database', comparedAt: new Date().toISOString(),
    payment: toPaymentRow(payment, order), order: order ? { id: order._id.toString(), orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus, amount: order.amount, currency: order.currency } : null,
    reconciliation: { consistent: mismatch.consistent, reasons: mismatch.reasons, stalePending: isStalePending(payment), thresholdMinutes: STALE_PENDING_MINUTES() },
    timeline: events.map((event) => ({ type: event.type, status: event.status, timestamp: event.occurredAt })),
    webhookEvents: webhookEvents.map((event) => ({ eventId: event.eventId, eventType: event.eventType, status: event.status, receivedAt: event.createdAt, processedAt: event.processedAt || null, error: event.error || null })),
  }
}
