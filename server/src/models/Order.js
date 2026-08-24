import mongoose from 'mongoose'
import { ORDER_STATE_VALUES, PAYMENT_STATES, PAYMENT_STATE_VALUES } from '../utils/paymentStates.js'

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  unitAmount: { type: Number, required: true, min: 0, validate: Number.isInteger },
}, { _id: false })

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderNumber: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  razorpayOrderId: { type: String, trim: true, minlength: 1 },
  amount: { type: Number, required: true, min: 1, validate: Number.isInteger },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: ORDER_STATE_VALUES, default: 'PENDING_PAYMENT', required: true },
  paymentStatus: { type: String, enum: PAYMENT_STATE_VALUES, default: PAYMENT_STATES.CREATED, required: true },
  items: { type: [itemSchema], required: true, validate: [(items) => items.length > 0, 'At least one item is required'] },
}, { timestamps: true })

orderSchema.index({ orderNumber: 1 }, { unique: true })
orderSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true })
orderSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('Order', orderSchema)
