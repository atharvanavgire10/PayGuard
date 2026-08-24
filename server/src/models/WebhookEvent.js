import mongoose from 'mongoose'

const webhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, trim: true, minlength: 1, maxlength: 255 },
  eventType: { type: String, required: true, trim: true, minlength: 1, maxlength: 255 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, required: true, enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'], default: 'RECEIVED' },
  processedAt: { type: Date },
  error: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true })

webhookEventSchema.index({ eventId: 1 }, { unique: true })
webhookEventSchema.index({ status: 1, createdAt: 1 })

export default mongoose.model('WebhookEvent', webhookEventSchema)
