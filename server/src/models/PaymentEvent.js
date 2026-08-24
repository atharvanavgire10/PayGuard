import mongoose from 'mongoose'

export const PAYMENT_EVENT_TYPES = [
  'PAYMENT_CREATED', 'PAYMENT_PENDING', 'PAYMENT_VERIFICATION_STARTED',
  'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAYMENT_FAILED',
  'PAYMENT_RECONCILIATION_STARTED', 'PAYMENT_RECONCILIATION_SUCCESS',
  'PAYMENT_RECONCILIATION_FAILED', 'ORDER_CREATED', 'DUPLICATE_PAYMENT_DETECTED',
]

const paymentEventSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  type: { type: String, required: true, enum: PAYMENT_EVENT_TYPES },
  status: { type: String, required: true, enum: ['completed', 'pending', 'failed'] },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true })

paymentEventSchema.index({ paymentId: 1, occurredAt: 1 })
paymentEventSchema.index({ orderId: 1, occurredAt: 1 })

export default mongoose.model('PaymentEvent', paymentEventSchema)
