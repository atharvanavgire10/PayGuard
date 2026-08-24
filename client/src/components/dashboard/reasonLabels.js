// Labels for the reason codes the backend derives from stored state. The client only renders them.
export const REASON_LABELS = Object.freeze({
  UNKNOWN_PAYMENT: 'Payment state unknown',
  ORDER_UNDER_REVIEW: 'Order under review',
  STALE_PENDING_PAYMENT: 'Pending beyond threshold',
  CAPTURED_ORDER_NOT_PAID: 'Captured but order not paid',
  PAID_ORDER_NOT_CAPTURED: 'Order paid but payment not captured',
  ORDER_PAYMENT_STATUS_DRIFT: 'Order payment status out of sync',
  ORDER_MISSING: 'Order record missing',
  WEBHOOK_PROCESSING_FAILED: 'Webhook processing failed',
})

export const reasonLabel = (reason) => REASON_LABELS[reason] || reason
