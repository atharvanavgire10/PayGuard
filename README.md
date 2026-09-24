# PayGuard

Payment reliability infrastructure for ecommerce. PayGuard sits between a storefront and Razorpay and makes sure the database eventually agrees with the payment gateway, even when the browser closes, the network drops, or a webhook arrives twice.

Razorpay **Test Mode only**. PayGuard does not process real money and refuses to start a checkout with a key that is not `rzp_test_*`.

## The problem

A card is charged. The gateway records a success. Then the customer's connection drops before the confirmation reaches your server, and your database still says `PENDING`.

That gap is where ecommerce loses money and trust. The customer sees no order and pays again, so you owe a refund and a support conversation. Or you optimistically mark the order paid, ship it, and discover the payment actually failed. The naive fixes make it worse: trusting the browser's callback means a forged request can fake a payment, and retrying blindly creates duplicate charges.

The gateway is the only authority on whether money moved. PayGuard's job is to keep asking it, and to converge on the truth without ever guessing.

Live Demo: https://pay-guard-sooty.vercel.app/

## Core guarantees

**Never invent a success.** A payment becomes `CAPTURED` only from a verified gateway signature — an HMAC-verified webhook or an HMAC-verified client callback. A payment that is merely stuck goes to manual review, never to paid.

**Every write is idempotent.** Duplicate webhooks, repeated verification calls, and repeated reconciliation runs all converge to the same state, enforced by unique database indexes rather than by application bookkeeping.

**No illegal state transitions.** Both status machines route through one chokepoint, so a `PAID` order can never be silently rewritten.

**Failures are recorded, not swallowed.** A failed reconciliation writes an audit event, releases its lock, and lets the next run retry.

## Architecture

```
Browser (React + Vite)
  │  POST /api/orders ──────────────┐
  │  POST /api/payments/verify ─────┤
  │  GET  /api/payments/:id/status ─┤
  └─ GET  /dashboard ───────────────┤
                                    ▼
                     ┌──────────────────────────────┐
Razorpay ──webhook──▶│  Express API                 │
                     │  routes → controllers        │
                     │        → services  ◀── the   │
                     │        → models    only      │
                     │                    writers   │
                     └──────────────┬───────────────┘
                                    ▼
                              MongoDB (Mongoose)
                    Order · Payment · PaymentEvent
                    WebhookEvent · OperationalEvent
                    ReconciliationLock · User
                                    ▲
                     scheduled reconciliation worker
                     (holds ReconciliationLock)
```

Routes stay thin, controllers only translate HTTP, and all business rules live in `server/src/services/payment/`. Every state change passes through `stateTransitionService`, so there is exactly one place where a transition can be rejected. See [docs/architecture.md](docs/architecture.md) for the module-level view and the reasoning behind each boundary.

## Payment lifecycle

Payment: `CREATED → PENDING → AUTHORIZED | CAPTURED | FAILED | UNKNOWN`, with `CAPTURED → REFUNDED`. `UNKNOWN` is recoverable and can move back to any settled state once the gateway confirms one; `FAILED`, `PAID`, and `REFUNDED` are terminal.

Order: `PENDING_PAYMENT → PAID | PAYMENT_FAILED | PAYMENT_REVIEW | CANCELLED`. `PAID` is terminal, which is what stops reconciliation from ever downgrading a completed order.

`UNKNOWN` and `PAYMENT_REVIEW` are the states that make the system honest. When PayGuard cannot prove what happened, it says so instead of picking an outcome.

A normal checkout: `POST /api/orders` creates a local `Order`, a Razorpay order, and a `Payment` in `PENDING` with a unique idempotency key. The browser opens Razorpay Checkout. On success it posts the gateway signature to `POST /api/payments/verify`, which recomputes the HMAC over `razorpay_order_id|razorpay_payment_id` and compares it in constant time. Only then does the payment reach `CAPTURED` and the order `PAID`.

If order creation fails partway, the compensating path runs: a local order with no Razorpay counterpart is deleted, but once the gateway order exists the local order is moved to `PAYMENT_REVIEW` / `UNKNOWN` rather than deleted, because a payment may already be in flight against it.

## Webhook recovery

The browser is unreliable, so the webhook is the real recovery channel. `POST /api/webhooks/razorpay` handles `payment.captured` and `payment.failed` and can complete a payment the client never reported.

Signature verification runs on the exact raw request bytes. `express.raw()` is mounted on the webhook path *before* the global `express.json()` parser, because JSON round-tripping would change the bytes and break the HMAC. Verification uses `crypto.timingSafeEqual` after a length check. An invalid signature returns `400` and writes nothing.

Only an allowlisted subset of the gateway payload is stored — event type, payment id, order id, status, amount, currency, method. Raw gateway payloads are never persisted.

## Idempotency

Enforced by the database, not by application logic:

- `WebhookEvent.eventId` is unique. A redelivered `X-Razorpay-Event-Id` surfaces as a duplicate-key error, which is caught and returned as a successful no-op.
- `Payment.razorpayPaymentId` and `Payment.idempotencyKey` are unique, so the same gateway payment cannot be recorded twice.
- Reconciliation writes audit events through a record-once helper that checks for an existing `{paymentId, type}` before inserting.
- Capture is guarded by a status check, so a second `payment.captured` for an already-captured payment changes nothing.

The suite proves this by counting stored records after a repeated delivery, not by trusting return values.

## Automated reconciliation

`reconciliationService` is strictly read-only: it compares stored `Payment`, `Order`, and `WebhookEvent` records and reports mismatches. It never writes and never contacts Razorpay. That is what the dashboard reads.

`automatedReconciliationService` is the only repairing path, and it repairs exactly one situation: a payment already `CAPTURED` whose order never reached `PAID`. The gateway has already been verified for those, so completing the order invents nothing. Anything else — a stuck `PENDING`, an `UNKNOWN`, a missing order, a rejected transition — is recorded as `MANUAL_REVIEW_REQUIRED` and left alone.

A per-payment failure is caught, recorded as `PAYMENT_RECONCILIATION_FAILED`, and the scan continues, so one bad record cannot stall the batch.

## Scheduled reconciliation and distributed locking

The worker in `reconciliationWorker.js` runs reconciliation on an interval (default five minutes, `RECONCILIATION_INTERVAL_MS=0` disables it). It owns no repair rules of its own — it only calls the same service the HTTP endpoint calls, so a production queue can replace it without touching payment logic.

Two guards prevent overlap. An in-process flag stops a slow run from being re-entered by the next tick. A distributed lock stops *two processes* from reconciling at once, which matters as soon as you run more than one instance:

`ReconciliationLock` has a unique `name`, and acquisition is a single atomic `findOneAndUpdate` matching only a lock that is absent or expired. A losing racer gets a duplicate-key error, which is treated as the normal "someone else owns it" answer and the run skips. The lock is released in a `finally` block, so a crashed run still frees it, and a TTL index reclaims anything abandoned by a hard kill.

On `SIGINT`/`SIGTERM` the server stops accepting connections, then waits for an in-flight reconciliation to finish so it releases the lock itself, then disconnects from MongoDB. A ten-second timeout forces exit so a stuck connection cannot hang a container. Without that wait, a deploy could strand the lock and block the next instance's worker for the full TTL.

## Failure handling

Error responses carry a message and nothing else. Anything that is not a deliberate `AppError` collapses to a single generic 500, so stack traces, driver errors, and configuration values never reach a client. Unexpected 500s log the method, route path, and error name — never the body, query string, or headers, since those carry customer and payment data.

Worker failures are recorded as `OperationalEvent` with no error payload attached, deliberately, so a message containing a secret cannot be persisted. A test asserts that.

## Security

- Secrets live only in `server/.env`, which is gitignored. Nothing is hardcoded.
- Razorpay Test Mode only; a non-test key is refused at startup and at checkout.
- The webhook secret and API key secret never leave the server. The client receives only the public `razorpayKeyId`.
- Payment responses are built by an explicit allowlist. `idempotencyKey` and `signatureVerified` are deliberately omitted; no card data, CVV, or UPI PIN is ever stored or returned.
- `helmet`, `x-powered-by` disabled, CORS restricted to `CLIENT_URL`, 100 kB body cap, Zod schemas with `.strict()` so unknown fields are rejected.
- Rate limits on sensitive routes: 10/min on checkout, 5/min on reconciliation, 60/min on the webhook.
- **Authentication is not implemented.** Rather than ship a placeholder auth system, the reliability dashboard and the manual reconciliation endpoint return `404` unless `NODE_ENV` is exactly `development`.

## Local development setup

Requires Node.js 20+, MongoDB, and a Razorpay Test Mode account.

```bash
cd server && npm install && cp .env.example .env   # then fill in .env
npm run dev                                        # http://localhost:5000
```

```bash
cd client && npm install
npm run dev                                        # http://localhost:5173
```

Checkout is at `/checkout`, payment status at `/payment/:paymentId`, and the development-only dashboard at `/dashboard`.

## Environment variables

Server (`server/.env`, see `.env.example`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | recommended | `development` enables the dashboard, manual reconciliation, and the worker |
| `PORT` | no | API port, default `5000` |
| `MONGODB_URI` | **yes** | MongoDB connection string |
| `RAZORPAY_KEY_ID` | yes for checkout | Test Mode key id (`rzp_test_*`) |
| `RAZORPAY_KEY_SECRET` | yes for checkout | Test Mode key secret |
| `RAZORPAY_WEBHOOK_SECRET` | yes for webhooks | Webhook signing secret, distinct from the key secret |
| `CLIENT_URL` | recommended | Allowed CORS origin, default `http://localhost:5173` |
| `RECONCILIATION_INTERVAL_MS` | no | Worker interval, default `300000`, `0` disables |
| `DASHBOARD_PENDING_MINUTES` | no | Stale-pending threshold, default `15` |

Client (`client/.env`): `VITE_API_URL`, default `http://localhost:5000/api`. Vite inlines `VITE_*` into the bundle, so never put a secret there.

Startup validates configuration and fails fast, reporting missing variable **names only** so a secret value cannot leak into a log.

## Tests and build

```bash
cd server && npm test        # Jest + Supertest
cd client && npm run test    # Vitest + React Testing Library
cd client && npm run build   # production bundle
```

Coverage spans the state machine, checkout, webhook verification and idempotency, reconciliation, the distributed lock, the worker, security middleware, and the dashboard. `server/tests/reliabilityPipeline.test.js` wires one shared store through the real webhook service, reconciliation service, lock, and worker, proving the whole recovery pipeline end to end.

## Production deployment guidance

Set `NODE_ENV=production`, which disables the dashboard, the manual reconciliation endpoint, the in-process worker, and checkout diagnostics. Supply every secret through the platform's secret manager, never a committed file. Point `CLIENT_URL` at the real origin. Terminate TLS in front of the API — Razorpay requires HTTPS for webhooks. Ensure the platform sends `SIGTERM` and allows at least ten seconds for graceful shutdown. Use `GET /api/health` for liveness and `GET /api/health/ready` for readiness so traffic is withheld while the database is unreachable. Run MongoDB with replication and backups; the reconciliation audit trail is the record of what happened to real money.

Before serving real customers you must add authentication and authorization, then re-enable the dashboard behind it.

## Known limitations

- No authentication or authorization, which is why the dashboard is development-only.
- Razorpay Test Mode only. No Live Mode, and no refund, partial-capture, or dispute flows.
- Reconciliation is database-only. It never calls Razorpay's API to ask about a payment it has no webhook for, so a payment that produced no webhook at all stays in manual review.
- The scheduled worker is in-process. It is safe across instances via the distributed lock, but a dedicated queue would be the production choice.
- The catalog is a single hardcoded demo SKU; there is no inventory, shipping, or tax handling.
- Multi-instance deployments share the lock but have no leader election, so all instances contend on every tick.
- No metrics, tracing, or alerting integration. Operational signals are database records and stdout logs.

## Documentation

- [docs/architecture.md](docs/architecture.md) — module boundaries and design decisions
- [docs/api.md](docs/api.md) — status endpoints
- [docs/webhooks.md](docs/webhooks.md) — webhook setup and verification
- [docs/dashboard.md](docs/dashboard.md) — reliability dashboard
- [docs/recovery-simulation.md](docs/recovery-simulation.md) — failure and recovery simulation
