import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api', timeout: 10000 })

export async function getPaymentStatus(paymentId) {
  const { data } = await api.get(`/payments/${encodeURIComponent(paymentId)}/status`)
  return data
}

export async function getOrderStatus(orderId) {
  const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}/status`)
  return data
}

export async function createOrder(payload) {
  const { data } = await api.post('/orders', payload)
  return data
}

export async function verifyPayment(payload) {
  const { data } = await api.post('/payments/verify', payload)
  return data
}

export function toSafeApiError(error) {
  const status = error?.response?.status
  const serverMessage = error?.response?.data?.error?.message
  if ([400, 404, 409, 503].includes(status) && serverMessage) return serverMessage
  if (status === 400) return 'The payment reference is not valid. Please check it and try again.'
  if (status === 404) return 'We could not find this payment or order.'
  if (error?.code === 'ECONNABORTED' || !error?.response) return 'We could not reach PayGuard. Your payment status is unchanged; please try again shortly.'
  return 'Payment status is temporarily unavailable. Please try again shortly.'
}
