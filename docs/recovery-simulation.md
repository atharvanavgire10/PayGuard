# Payment recovery simulation

This simulation demonstrates the reliability problem PayGuard exists to solve: a payment succeeds at the gateway, the browser never receives its confirmation, and the payment is recovered only by a verified webhook — without creating a duplicate order or payment.

It is **development/test-only**. It refuses to run when `NODE_ENV=production`, and it never marks a payment successful by itself: capture happens exclusively through `POST /api/webhooks/razorpay`, which still enforces raw-body signature verification and the state transition rules.

## Running it

The API must be running and connected to MongoDB, with `RAZORPAY_WEBHOOK_SECRET` set in `server/.env`.

```bash
cd server
npm run dev            # in one terminal
npm run recovery:simulate   # in another
```

Options:

- `--status=PENDING` (default) or `--status=UNKNOWN` — which ambiguous state to recover from.
- `--razorpay-order-id=order_...` — reuse an existing PENDING/UNKNOWN payment instead of seeding a new one.
- `--endpoint=<url>` — target a different webhook URL, for example a public tunnel host.
- `--cleanup` — delete the records this run created (refuses to delete records it did not create).

## What it does

It seeds (or reuses) one Order and one Payment in an ambiguous state, then deliberately skips `POST /api/payments/verify` to simulate the browser confirmation being unavailable. It delivers a correctly signed `payment.captured` webhook using a controlled event ID derived from the payment, then delivers the **exact same event ID a second time** to prove idempotency.

It then asserts, by querying the database:

- payment is `CAPTURED`, order is `PAID` with `paymentStatus: CAPTURED`
- exactly 1 Order, exactly 1 Payment for that order
- exactly 1 `PAYMENT_CAPTURED` PaymentEvent
- exactly 1 WebhookEvent for the event ID, in status `PROCESSED`

Every check prints `PASS`/`FAIL`, and the script exits non-zero if any check fails.

## Automated coverage

`server/tests/paymentRecoverySimulation.test.js` covers the same guarantees against the real `razorpayWebhookService` without needing a database or a running server: `PENDING → CAPTURED` and `UNKNOWN → CAPTURED` recovery, order promotion to `PAID`, a valid webhook, an invalid signature changing nothing, and repeated deliveries producing no duplicate WebhookEvent, PaymentEvent, Payment, or Order.
