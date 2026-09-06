# Reliability dashboard

A merchant-facing reconciliation view that **reads** authoritative PayGuard state and surfaces payments that may need investigation. It is observability only: it performs no database writes, calls no Razorpay API, and never decides a payment outcome itself. Every condition it displays is derived from stored `Payment`, `Order`, and `WebhookEvent` records.

It is **development-only**. Authentication has not been implemented yet, and rather than ship a placeholder auth system the entire surface returns `404` when `NODE_ENV=production` (`server/src/middleware/requireDevelopment.js`).

## Endpoints

All are `GET`, all read-only, all behind the development guard.

- `/api/dashboard/summary` — counts: total, captured, pending, failed and unknown payments; paid orders; orders requiring attention; duplicate webhook events; failed webhook events.
- `/api/dashboard/payments?limit=20` — recent payment activity joined to its order (order number, payment id, Razorpay payment id when present, amount, currency, payment status, order status, created/updated times).
- `/api/dashboard/attention?limit=50` — the attention queue, with a machine-readable `reasons` array per entry.
- `/api/dashboard/reconciliation/:paymentId` — a single payment compared against its order, plus its `PaymentEvent` timeline and related webhook deliveries.

The UI lives at **`/dashboard`**.

## Automated repair (development only)

`POST /api/reconciliation/run` runs the narrowly scoped reconciliation engine in development. It repairs only a stored `CAPTURED` payment whose associated order is not `PAID`, using the normal order state-transition service. `PENDING` and `UNKNOWN` payments are never promoted: they receive a deduplicated `MANUAL_REVIEW_REQUIRED` audit event instead. The runner records `RECONCILIATION_STARTED` and `ORDER_REPAIRED` only for an actual safe repair.

## Scheduled reconciliation (development only)

The server starts a lightweight in-process worker in development that calls the same automated reconciliation service every five minutes. Set `RECONCILIATION_INTERVAL_MS` to a whole number of milliseconds (minimum `1000`) to change the interval; set it to `0`, or an invalid value, to disable the worker. The worker never overlaps executions and stops when the server receives `SIGINT` or `SIGTERM`. It is intentionally isolated so a production job queue can replace it later without changing repair rules.

## What lands in the attention queue

An entry appears only when the database actually says so:

- `UNKNOWN_PAYMENT` — payment status is `UNKNOWN`.
- `ORDER_UNDER_REVIEW` — order status is `PAYMENT_REVIEW`.
- `STALE_PENDING_PAYMENT` — payment is still `PENDING` past the threshold (default 15 minutes, override with `DASHBOARD_PENDING_MINUTES`).
- `CAPTURED_ORDER_NOT_PAID` / `PAID_ORDER_NOT_CAPTURED` / `ORDER_PAYMENT_STATUS_DRIFT` — payment and order disagree.
- `ORDER_MISSING` — the payment references an order that no longer exists.
- `WEBHOOK_PROCESSING_FAILED` — a `WebhookEvent` was stored with status `FAILED`.

Two deliberate design decisions are worth knowing, because both exist to avoid reporting a failure that isn't real:

**Mismatches are only judged once a payment settles.** `checkoutService` creates an order with `paymentStatus: CREATED` alongside a payment with `status: PENDING`, so a healthy brand-new order legitimately has those two fields disagreeing. Status drift is therefore only flagged when the payment has reached `CAPTURED`, `FAILED`, or `REFUNDED`. A naive equality check would have flagged every new order.

**Duplicate webhook events are derived, not stored.** The webhook service suppresses a redelivered event id at the unique index and returns without persisting a second record, so there is no row to count. The dashboard instead reports how many stored webhook events share a gateway payment id: `count(events with a payload paymentId) − distinct(payload paymentId)`. That detects one gateway payment arriving under more than one event id, which is the duplicate case that matters. Same-event-id redeliveries are invisible here by design — the recovery simulation is what proves those are handled.

## What is never exposed

The payment row is built by an explicit allowlist (`toPaymentRow`), not by returning documents wholesale. `idempotencyKey` and `signatureVerified` are deliberately omitted, and raw webhook payloads are never returned — only the `paymentId` and `orderId` picked out of them. There is no card, CVV, UPI PIN, key, or secret anywhere in the surface. Internal errors are still masked by the existing error handler, so a failure returns `Unable to retrieve payment status.` rather than a driver message.

## Manual verification

Start MongoDB and both dev servers, then open `http://localhost:5173/dashboard`.

```bash
cd server && npm run dev
cd client && npm run dev
```

**Empty state.** Against a database with no payments, the summary cards should all read `0`, the attention queue should say nothing needs attention, and the payments table should say no payments have been recorded.

**Healthy state.** Complete a normal Test Mode checkout through `/checkout`. The payment should appear in the recent payments table as `CAPTURED` / `PAID`, and the attention queue should stay empty — a successful payment is not a problem to investigate.

**Recovery state.** Run the recovery simulation and watch the dashboard across it:

```bash
cd server && npm run recovery:simulate
```

Before the webhook is delivered the payment is `PENDING`; once it is older than the threshold it appears under `STALE_PENDING_PAYMENT`. After the webhook is processed it becomes `CAPTURED` / `PAID` and leaves the queue. To see it sooner, start the server with a shorter threshold:

```bash
DASHBOARD_PENDING_MINUTES=1 npm run dev
```

**Mismatch state.** To see the mismatch indicator without corrupting real data, hand-edit one order in `mongosh` so it disagrees with its captured payment, then reload:

```js
db.orders.updateOne({ orderNumber: '<order number>' }, { $set: { status: 'PENDING_PAYMENT' } })
```

The entry should render with a red **State mismatch** badge and the reason `Captured but order not paid`. Set the order back to `PAID` afterwards.

**Failed webhook state.** Send a signed webhook for a Razorpay order id that has no matching local payment. The webhook service stores it as `FAILED` with `Matching payment was not found.`, and it should surface as a `WEBHOOK` entry in the queue.

**Error state.** Stop the API server and reload `/dashboard`. The page should show a safe error panel, not a stack trace or a blank screen.

**Production guard.** With the server started as `NODE_ENV=production`, every dashboard endpoint must return `404` while `/api/health` keeps working:

```bash
curl -i http://localhost:5000/api/dashboard/summary   # expect 404
curl -i http://localhost:5000/api/health              # expect 200
```
