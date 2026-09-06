# PayGuard architecture

## Layers

```
routes/         HTTP surface: path, rate limit, body parser, validation, dev guard
  ▼
controllers/    HTTP translation only — parse request, call a service, set a status code
  ▼
services/       All business rules. The only place that decides a payment outcome.
  ▼
models/         Mongoose schemas, indexes, and the constraints that enforce idempotency
```

Controllers hold no logic worth testing on its own; every one is a few lines that delegates and forwards errors to `next`. That is deliberate — it means the reliability tests can exercise the real rules by calling services directly, and the HTTP tests only need to confirm wiring.

## Service map

| Module | Writes? | Responsibility |
| --- | --- | --- |
| `checkoutService` | yes | Creates local order + gateway order + payment; verifies the client callback signature |
| `razorpayWebhookService` | yes | Verifies the webhook HMAC over raw bytes; applies capture/failure |
| `automatedReconciliationService` | yes | The only repair path: completes orders whose payment is already `CAPTURED` |
| `reconciliationService` | **no** | Read-only comparison and reporting; backs the dashboard |
| `reconciliationWorker` | no | Scheduling and locking only; owns no repair rules |
| `reconciliationLockService` | yes | Acquire/release the distributed lock |
| `stateTransitionService` | no | Single chokepoint validating every status change |
| `operationalEventService` | yes | Records worker failures with no error payload |
| `paymentProviderFactory` / `RazorpayProvider` | no | Isolates the gateway SDK behind three methods |

The read-only/write split is the important line. Anything that displays state is physically incapable of changing it, so a dashboard bug cannot corrupt payment data.

## Data model

`Order` and `Payment` hold current state. `PaymentEvent` is the append-only audit timeline. `WebhookEvent` stores each delivery with a unique `eventId`. `OperationalEvent` records worker-level failures that have no payment context. `ReconciliationLock` is the distributed mutex. `User` is minimal, existing only to attach orders to an email.

Indexes carry real invariants rather than being pure optimizations:

- `WebhookEvent.eventId` unique → duplicate webhook deliveries are rejected by the database
- `Payment.razorpayPaymentId` unique sparse → one gateway payment cannot be recorded twice
- `Payment.idempotencyKey` unique → retried checkout attempts cannot duplicate a payment
- `Payment.{orderId, attemptNumber}` unique → attempt numbering stays consistent
- `Order.orderNumber`, `Order.razorpayOrderId` unique → no duplicate orders
- `ReconciliationLock.name` unique → mutual exclusion; `expiresAt` TTL → abandoned locks reclaimed

## Trust boundaries

Only two inputs can move a payment to `CAPTURED`, and both are cryptographically verified:

1. **Client callback** — HMAC-SHA256 over `razorpay_order_id|razorpay_payment_id` using the key secret, compared with `crypto.timingSafeEqual`.
2. **Webhook** — HMAC-SHA256 over the exact raw request body using the webhook secret, same constant-time comparison.

Everything else — the browser's own claim of success, a stuck `PENDING`, an `UNKNOWN` — can only lead to manual review. This is the invariant the whole design protects.

Body-parser ordering is load-bearing: `express.raw()` is mounted on `/api/webhooks/razorpay` **before** the global `express.json()`. Reordering those two lines silently breaks signature verification, because JSON parse-and-reserialize does not reproduce the original bytes.

## Concurrency

Reconciliation must not run twice at once, so there are two independent guards:

- **In-process**: a `running` flag makes a second `runOnce()` return `{skipped: true}` while one is active, covering a slow run overlapping the next interval tick.
- **Cross-process**: `ReconciliationLock` covers two instances ticking simultaneously. Acquisition is one atomic `findOneAndUpdate` whose filter matches only an absent or expired lock; the unique index turns a lost race into E11000, read as "another worker owns it".

Release happens in `finally`, so a thrown reconciliation still frees the lock. The TTL index is the backstop for a process killed hard enough to skip `finally`. Graceful shutdown awaits the in-flight run specifically so the lock is released by its owner rather than waiting out the TTL.

## Failure philosophy

Three rules shape the error paths:

**Prefer an unresolved state to a wrong one.** `UNKNOWN` and `PAYMENT_REVIEW` exist so PayGuard can admit uncertainty. Nothing guesses an outcome.

**Repair only what the gateway already confirmed.** Reconciliation completes orders for payments that are already verified `CAPTURED`. It never promotes a payment.

**Record failures, keep going.** A per-payment failure inside a scan is caught, audited, and the batch continues. A worker failure is audited, the lock is released, and the next tick retries.

## Environment-gated surfaces

The reliability dashboard (`/api/dashboard/*`) and manual reconciliation (`POST /api/reconciliation/run`) return `404` unless `NODE_ENV === 'development'` exactly — not merely "not production". The scheduled worker starts only in development for the same reason. These surfaces read authoritative merchant data and have no authentication yet; shipping a placeholder auth system would have been worse than withholding the feature.
