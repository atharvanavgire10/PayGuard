import Razorpay from 'razorpay'

export class RazorpayProvider {
  constructor({ keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET } = {}) {
    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required to use Razorpay.')
    }
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret })
  }

  createOrder({ amount, currency, receipt, notes }) {
    return this.client.orders.create({ amount, currency, receipt, notes })
  }

  fetchPayment(paymentId) {
    return this.client.payments.fetch(paymentId)
  }

  fetchOrder(orderId) {
    return this.client.orders.fetch(orderId)
  }
}
