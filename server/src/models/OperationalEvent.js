import mongoose from 'mongoose'

const operationalEventSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['RECONCILIATION_WORKER_FAILED'] },
  status: { type: String, required: true, enum: ['failed'], default: 'failed' },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true })

operationalEventSchema.index({ type: 1, occurredAt: -1 })

export default mongoose.model('OperationalEvent', operationalEventSchema)
