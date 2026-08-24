import { getOrderStatus, getPaymentStatus } from '../services/payment/paymentStatusService.js'

export async function getPaymentStatusById(request, response, next) {
  try {
    response.status(200).json(await getPaymentStatus(request.params.paymentId))
  } catch (error) { next(error) }
}

export async function getOrderStatusById(request, response, next) {
  try {
    response.status(200).json(await getOrderStatus(request.params.orderId))
  } catch (error) { next(error) }
}
