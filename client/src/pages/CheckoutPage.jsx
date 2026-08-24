import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatAmount } from '../components/payment/PaymentProcessing.jsx'
import { createOrder, getPaymentStatus, toSafeApiError, verifyPayment } from '../services/api.js'
import { loadRazorpayCheckout, openRazorpayCheckout } from '../services/razorpayCheckout.js'

const demoCustomer = { name: 'PayGuard Test Customer', email: 'test@example.com' }
const demoItems = [{ sku: 'payguard-demo-order', name: 'PayGuard demo order', quantity: 1, amount: 129900 }]

export function createCheckoutPayload(customer, items) {
  if (!customer?.name?.trim() || !customer?.email?.trim()) throw new Error('A valid checkout customer is required.')
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one valid checkout item is required.')
  const normalizedItems = items.map(({ sku, quantity }) => {
    if (!sku || !Number.isInteger(quantity) || quantity < 1) throw new Error('Each checkout item requires a SKU and a positive whole-number quantity.')
    return { sku, quantity }
  })
  return { customer: { name: customer.name.trim(), email: customer.email.trim() }, items: normalizedItems }
}

export default function CheckoutPage({ checkoutCustomer = demoCustomer, checkoutItems = demoItems }) {
  const total = checkoutItems.reduce((sum, item) => sum + item.amount * item.quantity, 0)
  const navigate = useNavigate()
  const [method, setMethod] = useState('upi')
  const [state, setState] = useState('')
  const [error, setError] = useState('')
  const [orderApi, setOrderApi] = useState({ status: 'Not started', httpStatus: null })

  async function pay() {
    setError('')
    let payload
    try { payload = createCheckoutPayload(checkoutCustomer, checkoutItems) } catch (validationError) { setOrderApi({ status: 'Failed', httpStatus: null }); setError(validationError.message); return }
    setState('Creating secure order…'); setOrderApi({ status: 'Loading', httpStatus: null })
    try {
      const checkout = await createOrder(payload)
      setOrderApi({ status: 'Success', httpStatus: 201 }); setState('Opening Razorpay Test Checkout…')
      await loadRazorpayCheckout()
      openRazorpayCheckout({ key: checkout.razorpayKeyId, amount: checkout.amount, currency: checkout.currency, name: 'PayGuard', description: checkout.orderNumber, order_id: checkout.razorpayOrderId, handler: async (result) => {
        setState('Verifying your payment…')
        try { const verified = await verifyPayment(result); await getPaymentStatus(verified.paymentId); navigate('/payment/processing', { state: { reference: { type: 'payment', id: verified.paymentId } } }) } catch (verifyError) { setError(toSafeApiError(verifyError)); setState('') }
      }, modal: { ondismiss: () => { setState(''); setError('Checkout was closed. We have not marked your payment as failed. Check its status if you completed payment.') } } })
    } catch (checkoutError) { setState(''); setOrderApi({ status: 'Failed', httpStatus: checkoutError?.response?.status ?? null }); setError(toSafeApiError(checkoutError)) }
  }

  return <main className="checkout"><header><p className="eyebrow">PayGuard checkout</p><h1>Review your order</h1></header><section className="checkout-card"><ul>{checkoutItems.map((item) => <li key={item.sku}><span>{item.name}<small>Quantity: {item.quantity}</small></span><strong>{formatAmount(item.amount, 'INR')}</strong></li>)}</ul><div className="total"><span>Total</span><strong>{formatAmount(total, 'INR')}</strong></div><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="upi">UPI</option><option value="card">Card</option></select></label><button type="button" onClick={pay} disabled={Boolean(state)}>{state || 'Pay securely'}</button>{error && <p role="alert" className="error-state">{error}</p>}<aside className="checkout-diagnostic" aria-label="Development order API diagnostic"><strong>Order API diagnostic</strong><span>Status: {orderApi.status}</span><span>HTTP status: {orderApi.httpStatus ?? 'null'}</span></aside><p className="muted">Razorpay Test Mode only. No real money is used.</p></section></main>
}
