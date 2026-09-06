import mongoose from 'mongoose'

const reconciliationLockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  ownerId: { type: String, required: true, trim: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true })

// MongoDB's TTL monitor cleans up abandoned records eventually; acquisition also checks expiresAt
// so stale locks are immediately recoverable without waiting for that monitor.
reconciliationLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('ReconciliationLock', reconciliationLockSchema)
