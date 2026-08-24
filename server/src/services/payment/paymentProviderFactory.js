import { RazorpayProvider } from './providers/RazorpayProvider.js'

export function createPaymentProvider(provider = 'razorpay') {
  if (provider !== 'razorpay') {
    throw new Error(`Unsupported payment provider: ${provider}`)
  }
  return new RazorpayProvider()
}
