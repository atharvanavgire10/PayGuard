import { processRazorpayWebhook } from '../services/payment/razorpayWebhookService.js'
export async function receiveRazorpayWebhook(request, response, next) {
  try { await processRazorpayWebhook({ rawBody: request.body, signature: request.get('x-razorpay-signature'), eventId: request.get('x-razorpay-event-id') }); response.status(200).json({ received: true }) } catch (error) { next(error) }
}
