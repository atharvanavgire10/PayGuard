import mongoose from 'mongoose'
import Order from '../../models/Order.js'
import Payment from '../../models/Payment.js'
import PaymentEvent from '../../models/PaymentEvent.js'
import { AppError } from '../../utils/AppError.js'

function assertObjectId(id, entity) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw new AppError(400, `Invalid ${entity} identifier.`)
  }
}

function toPayment(payment) {
  return {
    id: payment._id.toString(), status: payment.status, amount: payment.amount,
    currency: payment.currency, method: payment.method, razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId, createdAt: payment.createdAt, updatedAt: payment.updatedAt,
  }
}

function toOrder(order) {
  return {
    id: order._id.toString(), orderNumber: order.orderNumber, status: order.status,
    paymentStatus: order.paymentStatus,
  }
}

async function getTimeline(paymentId, orderId) {
  const events = await PaymentEvent.find({ $or: [{ paymentId }, { orderId }] }).sort({ occurredAt: 1 })
  return events.map((event) => ({ type: event.type, status: event.status, timestamp: event.occurredAt }))
}

export async function getPaymentStatus(paymentId) {
  assertObjectId(paymentId, 'payment')
  const payment = await Payment.findById(paymentId)
  if (!payment) throw new AppError(404, 'Payment not found.')

  const order = await Order.findById(payment.orderId)
  if (!order) throw new AppError(404, 'Associated order not found.')

  return { payment: toPayment(payment), order: toOrder(order), timeline: await getTimeline(payment._id, order._id) }
}

export async function getOrderStatus(orderId) {
  assertObjectId(orderId, 'order')
  const order = await Order.findById(orderId)
  if (!order) throw new AppError(404, 'Order not found.')

  const payment = await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 })
  if (!payment) throw new AppError(404, 'Associated payment not found.')

  return { payment: toPayment(payment), order: toOrder(order), timeline: await getTimeline(payment._id, order._id) }
}
