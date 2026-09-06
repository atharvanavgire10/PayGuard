import { jest } from '@jest/globals'
import ReconciliationLock from '../src/models/ReconciliationLock.js'
import { acquireReconciliationLock, RECONCILIATION_LOCK_NAME, releaseReconciliationLock } from '../src/services/payment/reconciliationLockService.js'

afterEach(() => jest.restoreAllMocks())

describe('distributed reconciliation lock', () => {
  it('acquires the named lock atomically when it is absent or expired', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    jest.spyOn(ReconciliationLock, 'findOneAndUpdate').mockResolvedValue({})
    await expect(acquireReconciliationLock({ ownerId: 'worker-a', now, ttlMs: 1000 })).resolves.toBe(true)
    expect(ReconciliationLock.findOneAndUpdate).toHaveBeenCalledWith(
      { name: RECONCILIATION_LOCK_NAME, expiresAt: { $lte: now } },
      expect.objectContaining({ $set: { ownerId: 'worker-a', expiresAt: new Date('2026-01-01T00:00:01.000Z') } }),
      expect.objectContaining({ upsert: true }),
    )
  })

  it('does not acquire an active lock held by another worker', async () => {
    jest.spyOn(ReconciliationLock, 'findOneAndUpdate').mockRejectedValue({ code: 11000 })
    await expect(acquireReconciliationLock({ ownerId: 'worker-b' })).resolves.toBe(false)
  })

  it('recovers a stale lock through the expired-lock predicate', async () => {
    const now = new Date('2026-01-01T00:10:00.000Z')
    jest.spyOn(ReconciliationLock, 'findOneAndUpdate').mockResolvedValue({})
    await expect(acquireReconciliationLock({ ownerId: 'worker-b', now })).resolves.toBe(true)
    expect(ReconciliationLock.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: { $lte: now } }), expect.anything(), expect.anything())
  })

  it('releases only the lock owned by the finishing worker', async () => {
    jest.spyOn(ReconciliationLock, 'deleteOne').mockResolvedValue({ deletedCount: 1 })
    await releaseReconciliationLock({ ownerId: 'worker-a' })
    expect(ReconciliationLock.deleteOne).toHaveBeenCalledWith({ name: RECONCILIATION_LOCK_NAME, ownerId: 'worker-a' })
  })
})
