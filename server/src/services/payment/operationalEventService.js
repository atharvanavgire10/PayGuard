import OperationalEvent from '../../models/OperationalEvent.js'

// Worker failures have no guaranteed payment/order context, so they are recorded separately
// from PaymentEvent. No error payload is stored to avoid persisting secrets or request data.
export async function recordReconciliationWorkerFailure() {
  await OperationalEvent.create({ type: 'RECONCILIATION_WORKER_FAILED', status: 'failed' })
}
