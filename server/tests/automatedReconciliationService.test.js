import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { runAutomatedReconciliation } from '../src/services/payment/automatedReconciliationService.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'

function payment(status, orderId = new mongoose.Types.ObjectId()) { return { _id: new mongoose.Types.ObjectId(), orderId, status } }
function order(id, status, paymentStatus = 'CAPTURED') { return { _id: id, status, paymentStatus, save: jest.fn() } }
function setup({ payments, orders, events = [] }) {
  jest.spyOn(Payment, 'find').mockReturnValue({ sort: jest.fn().mockResolvedValue(payments) })
  jest.spyOn(Order, 'findById').mockImplementation(async (id) => orders.get(id.toString()) || null)
  jest.spyOn(PaymentEvent, 'findOne').mockImplementation(async ({ paymentId, type }) => events.find((event) => event.paymentId.toString() === paymentId.toString() && event.type === type) || null)
  jest.spyOn(PaymentEvent, 'create').mockImplementation(async (event) => { events.push(event); return event })
  return events
}

afterEach(() => jest.restoreAllMocks())

describe('automated reconciliation runner', () => {
  it('safely repairs a captured payment whose order is not paid', async () => {
    const item = payment('CAPTURED'); const target = order(item.orderId, 'PENDING_PAYMENT'); const events = setup({ payments: [item], orders: new Map([[item.orderId.toString(), target]]) })
    await expect(runAutomatedReconciliation()).resolves.toEqual(expect.objectContaining({ scanned: 1, repaired: 1, manualReview: 0 }))
    expect(target.status).toBe('PAID'); expect(target.paymentStatus).toBe('CAPTURED'); expect(target.save).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.type)).toEqual(['RECONCILIATION_STARTED', 'ORDER_REPAIRED'])
  })

  it.each(['PENDING', 'UNKNOWN'])('does not guess success for %s payments and marks review once', async (status) => {
    const item = payment(status); const target = order(item.orderId, 'PENDING_PAYMENT', status); const events = setup({ payments: [item], orders: new Map([[item.orderId.toString(), target]]) })
    const result = await runAutomatedReconciliation()
    expect(result.manualReview).toBe(1); expect(target.save).not.toHaveBeenCalled(); expect(events.map((event) => event.type)).toEqual(['MANUAL_REVIEW_REQUIRED'])
  })

  it('leaves already-correct captured and paid records unchanged', async () => {
    const item = payment('CAPTURED'); const target = order(item.orderId, 'PAID'); const events = setup({ payments: [item], orders: new Map([[item.orderId.toString(), target]]) })
    await expect(runAutomatedReconciliation()).resolves.toEqual(expect.objectContaining({ repaired: 0, unchanged: 1 }))
    expect(events).toHaveLength(0); expect(target.save).not.toHaveBeenCalled()
  })

  it('is idempotent across repeated execution and does not duplicate repair events', async () => {
    const item = payment('CAPTURED'); const target = order(item.orderId, 'PENDING_PAYMENT'); const events = setup({ payments: [item], orders: new Map([[item.orderId.toString(), target]]) })
    await runAutomatedReconciliation(); await runAutomatedReconciliation()
    expect(events.filter((event) => event.type === 'ORDER_REPAIRED')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'RECONCILIATION_STARTED')).toHaveLength(1)
    expect(target.save).toHaveBeenCalledTimes(1)
  })

  it('handles multiple records independently', async () => {
    const repair = payment('CAPTURED'); const review = payment('UNKNOWN'); const correct = payment('CAPTURED')
    const repairOrder = order(repair.orderId, 'PAYMENT_REVIEW'); const reviewOrder = order(review.orderId, 'PAYMENT_REVIEW', 'UNKNOWN'); const correctOrder = order(correct.orderId, 'PAID')
    setup({ payments: [repair, review, correct], orders: new Map([[repair.orderId.toString(), repairOrder], [review.orderId.toString(), reviewOrder], [correct.orderId.toString(), correctOrder]]) })
    await expect(runAutomatedReconciliation()).resolves.toEqual(expect.objectContaining({ scanned: 3, repaired: 1, manualReview: 1, unchanged: 1 }))
  })

  it('reports per-record failures and continues scanning', async () => {
    const broken = payment('CAPTURED'); const recoverable = payment('CAPTURED'); const target = order(recoverable.orderId, 'PENDING_PAYMENT')
    const events = setup({ payments: [broken, recoverable], orders: new Map([[recoverable.orderId.toString(), target]]) })
    jest.spyOn(Order, 'findById').mockImplementation(async (id) => { if (id.toString() === broken.orderId.toString()) throw new Error('database unavailable'); return target })
    const result = await runAutomatedReconciliation()
    expect(result.failures).toEqual([{ paymentId: broken._id.toString(), message: 'Reconciliation could not process this payment.' }])
    expect(result.repaired).toBe(1); expect(events.filter((event) => event.type === 'ORDER_REPAIRED')).toHaveLength(1)
  })
})
