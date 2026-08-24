# Razorpay webhooks (Phase 12)

PayGuard receives Razorpay Test Mode callbacks at `POST /api/webhooks/razorpay`. The route verifies `X-Razorpay-Signature` against the exact raw request bytes using `RAZORPAY_WEBHOOK_SECRET`.

Supported events are `payment.captured` and `payment.failed`. Each `X-Razorpay-Event-Id` is stored uniquely in `WebhookEvent`; repeat deliveries return success without repeating payment, order, or timeline updates.

## Local Test Mode setup

1. Set `RAZORPAY_WEBHOOK_SECRET` in `server/.env` to the secret generated for the Razorpay Test Mode webhook.
2. Run the API locally on port 5000.
3. Expose it, for example: `ngrok http 5000`.
4. In Razorpay Test Mode Dashboard, create a webhook URL using `https://<tunnel-host>/api/webhooks/razorpay` and enable the supported payment events.
5. Complete a Test Mode checkout and verify the delivery plus PayGuard's payment/order status endpoints.

Never use Live Mode credentials or expose webhook/Razorpay secrets in frontend code.
