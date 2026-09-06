import ReconciliationLock from '../../models/ReconciliationLock.js'

export const RECONCILIATION_LOCK_NAME = 'scheduled-reconciliation'
export const RECONCILIATION_LOCK_TTL_MS = 10 * 60 * 1000

// The predicate and update run atomically in MongoDB. An active lock causes the unique-name
// upsert race to fail with E11000, which is treated as a normal "another worker owns it" result.
export async function acquireReconciliationLock({ ownerId, now = new Date(), ttlMs = RECONCILIATION_LOCK_TTL_MS } = {}) {
  const expiresAt = new Date(now.getTime() + ttlMs)
  try {
    await ReconciliationLock.findOneAndUpdate(
      { name: RECONCILIATION_LOCK_NAME, expiresAt: { $lte: now } },
      { $set: { ownerId, expiresAt }, $setOnInsert: { name: RECONCILIATION_LOCK_NAME } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

export async function releaseReconciliationLock({ ownerId } = {}) {
  await ReconciliationLock.deleteOne({ name: RECONCILIATION_LOCK_NAME, ownerId })
}
