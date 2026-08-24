import crypto from 'crypto'
import Order from '../../models/Order.js'
import Payment from '../../models/Payment.js'
import PaymentEvent from '../../models/PaymentEvent.js'
import WebhookEvent from '../../models/WebhookEvent.js'
import { AppError } from '../../utils/AppError.js'
import { assertOrderTransition, assertPaymentTransition } from './stateTransitionService.js'

function signatureIsValid(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new AppError(503, 'Webhook processing is not configured.')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const received = Buffer.from(signature || '', 'utf8'); const expectedBuffer = Buffer.from(expected, 'utf8')
  return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer)
}

function safePayload(eventType, entity) {
  return { eventType, paymentId: entity.id, orderId: entity.order_id, status: entity.status, amount: entity.amount, currency: entity.currency, method: entity.method }
}

export async function processRazorpayWebhook({ rawBody, signature, eventId }) {
  if (!signatureIsValid(rawBody, signature)) throw new AppError(400, 'Invalid webhook signature.')
  let body
  try { body = JSON.parse(rawBody.toString('utf8')) } catch { throw new AppError(400, 'Invalid webhook payload.') }
  const eventType = body.event; const entity = body.payload?.payment?.entity
  if (!eventId || !entity?.order_id || !['payment.captured', 'payment.failed'].includes(eventType)) return { ignored: true }
  try {
    await WebhookEvent.create({ eventId, eventType, payload: safePayload(eventType, entity), status: 'PROCESSING' })
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true }
    throw error
  }
  const webhook = await WebhookEvent.findOne({ eventId })
  try {
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id })
    if (!payment) { webhook.status = 'FAILED'; webhook.error = 'Matching payment was not found.'; await webhook.save(); return { ignored: true } }
    const order = await Order.findById(payment.orderId)
    if (!order) { webhook.status = 'FAILED'; webhook.error = 'Matching order was not found.'; await webhook.save(); return { ignored: true } }
    if (eventType === 'payment.captured' && payment.status !== 'CAPTURED') {
      assertPaymentTransition(payment.status, 'CAPTURED'); assertOrderTransition(order.status, 'PAID')
      payment.status = 'CAPTURED'; payment.razorpayPaymentId = entity.id; payment.method = entity.method || payment.method; payment.capturedAt = new Date(); await payment.save()
      order.status = 'PAID'; order.paymentStatus = 'CAPTURED'; await order.save()
      await PaymentEvent.create([{ paymentId: payment._id, orderId: order._id, type: 'PAYMENT_CAPTURED', status: 'completed' }, { paymentId: payment._id, orderId: order._id, type: 'ORDER_CREATED', status: 'completed' }])
    }
    if (eventType === 'payment.failed' && payment.status !== 'FAILED') {
      assertPaymentTransition(payment.status, 'FAILED')
      payment.status = 'FAILED'; payment.failureReason = entity.error_description || 'Payment failed at the gateway.'; await payment.save()
      if (['PENDING_PAYMENT', 'PAYMENT_REVIEW'].includes(order.status)) { assertOrderTransition(order.status, 'PAYMENT_FAILED'); order.status = 'PAYMENT_FAILED'; order.paymentStatus = 'FAILED'; await order.save() }
      await PaymentEvent.create({ paymentId: payment._id, orderId: order._id, type: 'PAYMENT_FAILED', status: 'failed' })
    }
    webhook.status = 'PROCESSED'; webhook.processedAt = new Date(); await webhook.save()
    return { processed: true }
  } catch (error) { webhook.status = 'FAILED'; webhook.error = 'Webhook processing failed.'; await webhook.save(); throw error }
}
