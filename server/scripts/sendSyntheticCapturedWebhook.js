// Development/test utility only. It sends a locally signed synthetic Razorpay webhook.
import crypto from 'crypto'
import 'dotenv/config'

const [razorpayOrderId, razorpayPaymentId, providedEventId] = process.argv.slice(2)
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET

if (!razorpayOrderId || !razorpayPaymentId) {
  console.error('Usage: node scripts/sendSyntheticCapturedWebhook.js <razorpayOrderId> <razorpayPaymentId> [eventId]')
  process.exit(1)
}

if (!webhookSecret) {
  console.error('RAZORPAY_WEBHOOK_SECRET must be set in server/.env.')
  process.exit(1)
}

const payload = {
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: razorpayPaymentId,
        order_id: razorpayOrderId,
        status: 'captured',
        amount: 129900,
        currency: 'INR',
        method: 'upi',
      },
    },
  },
}

const serializedPayload = JSON.stringify(payload)
const signature = crypto.createHmac('sha256', webhookSecret).update(serializedPayload, 'utf8').digest('hex')
const eventId = providedEventId || `dev-payment-captured-${crypto.randomUUID()}`

try {
  const response = await fetch('http://localhost:5000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signature,
      'X-Razorpay-Event-Id': eventId,
    },
    body: serializedPayload,
  })
  console.log(`HTTP ${response.status}`)
  console.log(await response.text())
} catch (error) {
  console.error(`Webhook request failed: ${error.message}`)
  process.exitCode = 1
}
