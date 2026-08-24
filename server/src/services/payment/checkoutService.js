import crypto from 'crypto'
import Order from '../../models/Order.js'
import Payment from '../../models/Payment.js'
import PaymentEvent from '../../models/PaymentEvent.js'
import User from '../../models/User.js'
import { AppError } from '../../utils/AppError.js'
import { createPaymentProvider } from './paymentProviderFactory.js'
import { assertOrderTransition, assertPaymentTransition } from './stateTransitionService.js'

// Amounts are integer INR paise. The browser submits SKU and quantity only.
const catalog = Object.freeze({ 'payguard-demo-order': { name: 'PayGuard demo order', unitAmount: 129900, currency: 'INR' } })
const isTestKey = (key) => key?.startsWith('rzp_test_')
const orderNumber = () => `PG-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const diagnosticsEnabled = () => process.env.NODE_ENV === 'development'
function diagnostic(event, details = {}) { if (diagnosticsEnabled()) console.info(event, JSON.stringify(details)) }
function safeFailure(error) { return { errorName: error.name || 'Error', safeErrorMessage: error instanceof AppError ? error.message : 'Order creation could not be completed.' } }

function validateCheckout({ customer, items }) {
  if (!customer?.name || !customer?.email || !Array.isArray(items) || items.length === 0) throw new AppError(400, 'Valid customer and items are required.')
  const resolved = items.map(({ sku, quantity }) => {
    const product = catalog[sku]
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new AppError(400, 'One or more checkout items are invalid.')
    return { name: product.name, quantity, unitAmount: product.unitAmount }
  })
  return { items: resolved, amount: resolved.reduce((total, item) => total + item.unitAmount * item.quantity, 0), currency: 'INR' }
}

export async function createCheckoutOrder(payload, { provider } = {}) {
  diagnostic('ORDER_CREATE_STARTED')
  let localOrder; let razorpayCreated = false; let step = 'VALIDATION'
  try {
    const { items, amount, currency } = validateCheckout(payload)
    if (!isTestKey(process.env.RAZORPAY_KEY_ID) || !process.env.RAZORPAY_KEY_SECRET) throw new AppError(503, 'Test payment checkout is not configured.')
    let user = await User.findOne({ email: payload.customer.email.toLowerCase() })
    if (!user) user = await User.create({ name: payload.customer.name, email: payload.customer.email })
    step = 'LOCAL_ORDER_CREATION'; diagnostic('LOCAL_ORDER_CREATION_STARTED')
    localOrder = await Order.create({ userId: user._id, orderNumber: orderNumber(), amount, currency, items })
    diagnostic('LOCAL_ORDER_CREATED', { localOrderId: localOrder._id.toString(), orderNumber: localOrder.orderNumber })
    step = 'RAZORPAY_ORDER_CREATION'; diagnostic('RAZORPAY_ORDER_CREATION_STARTED')
    const razorpayOrder = await (provider || createPaymentProvider()).createOrder({ amount, currency, receipt: localOrder.orderNumber, notes: { payguardOrderId: localOrder._id.toString() } })
    razorpayCreated = true; diagnostic('RAZORPAY_ORDER_CREATED', { razorpayOrderId: razorpayOrder.id })
    localOrder.razorpayOrderId = razorpayOrder.id
    await localOrder.save()
    step = 'PAYMENT_RECORD_CREATION'; diagnostic('PAYMENT_RECORD_CREATION_STARTED')
    const payment = await Payment.create({ orderId: localOrder._id, razorpayOrderId: razorpayOrder.id, amount, currency, status: 'PENDING', attemptNumber: 1, idempotencyKey: crypto.randomUUID() })
    diagnostic('PAYMENT_RECORD_CREATED', { localPaymentId: payment._id.toString() })
    await PaymentEvent.create([{ paymentId: payment._id, orderId: localOrder._id, type: 'PAYMENT_CREATED', status: 'completed' }, { paymentId: payment._id, orderId: localOrder._id, type: 'PAYMENT_PENDING', status: 'pending' }])
    const response = { orderId: localOrder._id.toString(), orderNumber: localOrder.orderNumber, paymentId: payment._id.toString(), razorpayOrderId: razorpayOrder.id, amount, currency, razorpayKeyId: process.env.RAZORPAY_KEY_ID }
    diagnostic('ORDER_CREATE_SUCCESS', { localOrderId: response.orderId, localPaymentId: response.paymentId, razorpayOrderId: response.razorpayOrderId })
    return response
  } catch (error) {
    diagnostic('ORDER_CREATE_FAILED', { step, ...safeFailure(error) })
    if (localOrder && !razorpayCreated) await Order.findByIdAndDelete(localOrder._id)
    if (localOrder && razorpayCreated && step === 'PAYMENT_RECORD_CREATION') {
      localOrder.status = 'PAYMENT_REVIEW'; localOrder.paymentStatus = 'UNKNOWN'; await localOrder.save()
    }
    throw error
  }
}

function safeCompare(actual, expected) {
  const actualBuffer = Buffer.from(actual || '', 'utf8'); const expectedBuffer = Buffer.from(expected, 'utf8')
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

export async function verifyCheckoutPayment({ razorpay_payment_id: paymentId, razorpay_order_id: submittedOrderId, razorpay_signature: signature }) {
  if (!paymentId || !submittedOrderId || !signature) throw new AppError(400, 'Payment verification details are required.')
  if (!process.env.RAZORPAY_KEY_SECRET) throw new AppError(503, 'Test payment checkout is not configured.')
  const payment = await Payment.findOne({ razorpayOrderId: submittedOrderId })
  if (!payment) throw new AppError(404, 'Payment order not found.')
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${payment.razorpayOrderId}|${paymentId}`).digest('hex')
  if (!safeCompare(signature, expected)) throw new AppError(400, 'Payment verification failed.')
  if (payment.razorpayPaymentId && payment.razorpayPaymentId !== paymentId) throw new AppError(409, 'This payment attempt was already verified.')
  const order = await Order.findById(payment.orderId)
  if (!order) throw new AppError(404, 'Associated order not found.')
  if (payment.status === 'CAPTURED') return { paymentId: payment._id.toString(), orderId: order._id.toString() }
  assertPaymentTransition(payment.status, 'CAPTURED'); assertOrderTransition(order.status, 'PAID')
  payment.razorpayPaymentId = paymentId; payment.signatureVerified = true; payment.status = 'CAPTURED'; payment.capturedAt = new Date(); await payment.save()
  order.status = 'PAID'; order.paymentStatus = 'CAPTURED'; await order.save()
  await PaymentEvent.create([{ paymentId: payment._id, orderId: order._id, type: 'PAYMENT_CAPTURED', status: 'completed' }, { paymentId: payment._id, orderId: order._id, type: 'ORDER_CREATED', status: 'completed' }])
  return { paymentId: payment._id.toString(), orderId: order._id.toString() }
}
