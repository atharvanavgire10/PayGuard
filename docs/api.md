# PayGuard status API (Phase 9.5)

These read-only endpoints expose the payment and order state stored in PayGuard's database. Authentication and authorization are deliberately not included in this prototype and must be added before production use.

## `GET /api/payments/:paymentId/status`

Returns the authoritative payment, its associated order, and only persisted timeline events.

`paymentId` must be a MongoDB ObjectId.

```json
{
  "payment": {
    "id": "...",
    "status": "UNKNOWN",
    "amount": 129900,
    "currency": "INR",
    "method": "upi",
    "razorpayOrderId": "order_...",
    "razorpayPaymentId": "pay_...",
    "createdAt": "2026-01-02T03:04:05.000Z",
    "updatedAt": "2026-01-02T03:04:05.000Z"
  },
  "order": {
    "id": "...",
    "orderNumber": "PG-100",
    "status": "PAYMENT_REVIEW",
    "paymentStatus": "UNKNOWN"
  },
  "timeline": [
    { "type": "PAYMENT_CREATED", "status": "completed", "timestamp": "2026-01-02T03:04:05.000Z" }
  ]
}
```

## `GET /api/orders/:orderId/status`

Returns the authoritative order, its latest associated payment, and only persisted timeline events. `orderId` must be a MongoDB ObjectId. The response shape is the same as the payment endpoint.

## Status codes

- `200` — status found
- `400` — malformed identifier
- `404` — requested record or associated record is absent
- `500` — unexpected failure, with no internal error details exposed

## Security

Responses deliberately omit gateway secrets, webhook secrets, database credentials, and sensitive payment credentials. These prototype endpoints have no authentication; authorization must be enforced before exposing them outside a trusted development environment.
