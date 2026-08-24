import mongoose from 'mongoose'
import { PAYMENT_STATES, PAYMENT_STATE_VALUES } from '../utils/paymentStates.js'

const paymentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  razorpayOrderId: { type: String, required: true, trim: true, minlength: 1, index: true },
  razorpayPaymentId: { type: String, trim: true, minlength: 1 },
  amount: { type: Number, required: true, min: 1, validate: Number.isInteger },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  method: { type: String, trim: true, maxlength: 50 },
  status: { type: String, enum: PAYMENT_STATE_VALUES, default: PAYMENT_STATES.CREATED, required: true },
  attemptNumber: { type: Number, required: true, min: 1, validate: Number.isInteger },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 16, maxlength: 255 },
  signatureVerified: { type: Boolean, default: false, required: true },
  failureReason: { type: String, trim: true, maxlength: 1000 },
  capturedAt: { type: Date },
}, { timestamps: true })

paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true })
paymentSchema.index({ idempotencyKey: 1 }, { unique: true })
paymentSchema.index({ orderId: 1, attemptNumber: 1 }, { unique: true })
paymentSchema.index({ razorpayOrderId: 1, createdAt: -1 })

export default mongoose.model('Payment', paymentSchema)
