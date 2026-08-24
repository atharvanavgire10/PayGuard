import { createCheckoutOrder, verifyCheckoutPayment } from '../services/payment/checkoutService.js'
export async function createOrder(request, response, next) {
  if (process.env.NODE_ENV === 'development') console.info('ORDER_CREATE_REQUEST', JSON.stringify({ customer: Boolean(request.body?.customer), itemCount: Array.isArray(request.body?.items) ? request.body.items.length : 0, items: request.body?.items?.map(({ sku, quantity }) => ({ sku, quantity })) }))
  try { response.status(201).json(await createCheckoutOrder(request.body)) } catch (error) { next(error) }
}
export async function verifyPayment(request, response, next) { try { response.status(200).json(await verifyCheckoutPayment(request.body)) } catch (error) { next(error) } }
