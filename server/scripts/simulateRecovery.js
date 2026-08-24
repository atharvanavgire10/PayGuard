// Development/test-only Phase 13 recovery simulation.
// It demonstrates PayGuard's core reliability problem: a payment succeeds at the gateway, the browser
// never receives its confirmation, and the payment is recovered only by a verified webhook.
// This script never marks a payment successful by itself. Capture happens exclusively through the real
// signed-webhook path in razorpayWebhookService, which still enforces signature and state transitions.
import crypto from 'crypto'
import 'dotenv/config'
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database.js'
import Order from '../src/models/Order.js'
import Payment from '../src/models/Payment.js'
import PaymentEvent from '../src/models/PaymentEvent.js'
import User from '../src/models/User.js'
import WebhookEvent from '../src/models/WebhookEvent.js'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback
const has = (name) => args.includes(`--${name}`)

const endpoint = flag('endpoint', 'http://localhost:5000/api/webhooks/razorpay')
const seedStatus = (flag('status', 'PENDING') || '').toUpperCase()
const existingRazorpayOrderId = flag('razorpay-order-id')
const shouldCleanup = has('cleanup')

const results = []
const check = (label, passed, detail = '') => { results.push({ label, passed, detail }); console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`) }
const step = (message) => console.log(`\n${message}`)
const hex = (bytes = 6) => crypto.randomBytes(bytes).toString('hex')

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this simulation is development/test-only and must never run in production.')
  process.exit(1)
}

if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
  console.error('RAZORPAY_WEBHOOK_SECRET must be set in server/.env to sign the simulated webhook.')
  process.exit(1)
}

if (!['PENDING', 'UNKNOWN'].includes(seedStatus)) {
  console.error(`Unsupported --status=${seedStatus}. Use PENDING or UNKNOWN, the two ambiguous states the recovery path must resolve.`)
  process.exit(1)
}

// Builds the ambiguous starting point: a real local Order + Payment left un-confirmed, exactly as it
// would be if the browser never came back from the gateway. No gateway call is made here.
async function seedAmbiguousPayment() {
  const suffix = hex()
  const user = await User.findOneAndUpdate({ email: 'simulation@payguard.local' }, { $setOnInsert: { name: 'PayGuard Simulation Customer', email: 'simulation@payguard.local' } }, { new: true, upsert: true })
  const amount = 129900
  const order = await Order.create({
    userId: user._id, orderNumber: `PG-SIM-${Date.now()}-${suffix.toUpperCase()}`, razorpayOrderId: `order_SIM${suffix}`,
    amount, currency: 'INR', items: [{ name: 'PayGuard demo order', quantity: 1, unitAmount: amount }],
    status: seedStatus === 'UNKNOWN' ? 'PAYMENT_REVIEW' : 'PENDING_PAYMENT', paymentStatus: seedStatus,
  })
  const payment = await Payment.create({ orderId: order._id, razorpayOrderId: order.razorpayOrderId, amount, currency: 'INR', status: seedStatus, attemptNumber: 1, idempotencyKey: crypto.randomUUID() })
  await PaymentEvent.create([{ paymentId: payment._id, orderId: order._id, type: 'PAYMENT_CREATED', status: 'completed' }, { paymentId: payment._id, orderId: order._id, type: 'PAYMENT_PENDING', status: 'pending' }])
  return { order, payment, createdBySimulation: true }
}

async function loadExistingPayment(razorpayOrderId) {
  const payment = await Payment.findOne({ razorpayOrderId })
  if (!payment) throw new Error(`No Payment found for razorpayOrderId ${razorpayOrderId}.`)
  if (!['PENDING', 'UNKNOWN'].includes(payment.status)) throw new Error(`Payment ${payment._id} is ${payment.status}; the recovery simulation needs a PENDING or UNKNOWN payment.`)
  const order = await Order.findById(payment.orderId)
  if (!order) throw new Error(`Payment ${payment._id} has no associated Order.`)
  return { order, payment, createdBySimulation: false }
}

// Sends the exact bytes it signs, so the endpoint's raw-body HMAC check is exercised for real.
async function deliverCapturedWebhook({ razorpayOrderId, razorpayPaymentId, eventId }) {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: razorpayPaymentId, order_id: razorpayOrderId, status: 'captured', amount: 129900, currency: 'INR', method: 'upi' } } } })
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body, 'utf8').digest('hex')
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId }, body })
  return { status: response.status, text: await response.text() }
}

async function run() {
  await connectToDatabase()
  const source = existingRazorpayOrderId ? await loadExistingPayment(existingRazorpayOrderId) : await seedAmbiguousPayment()
  const { order, payment } = source
  const razorpayPaymentId = payment.razorpayPaymentId || `pay_SIM${hex()}`
  const eventId = `sim-recovery-${payment._id}`

  step('STEP 1 — Ambiguous starting state (payment succeeded at the gateway, PayGuard does not know yet)')
  console.log(`  Order            ${order._id} (${order.orderNumber}) status=${order.status}`)
  console.log(`  Payment          ${payment._id} status=${payment.status}`)
  console.log(`  Razorpay order   ${payment.razorpayOrderId}`)
  console.log(`  Source           ${source.createdBySimulation ? 'newly seeded by this simulation' : 'existing record reused'}`)

  step('STEP 2 — Browser confirmation is unavailable')
  console.log('  Deliberately NOT calling POST /api/payments/verify.')
  console.log('  This is the failure being simulated: the customer closed the tab or lost connectivity,')
  console.log('  so the payment stays ambiguous and the customer is at risk of paying twice.')

  step(`STEP 3 — First verified webhook delivery (event ID ${eventId})`)
  const first = await deliverCapturedWebhook({ razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId, eventId })
  console.log(`  HTTP ${first.status} ${first.text}`)
  check('first delivery accepted', first.status === 200, `HTTP ${first.status}`)

  step('STEP 4 — Duplicate delivery of the exact same event ID')
  const second = await deliverCapturedWebhook({ razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId, eventId })
  console.log(`  HTTP ${second.status} ${second.text}`)
  check('duplicate delivery accepted without error', second.status === 200, `HTTP ${second.status}`)

  step('STEP 5 — Verify recovery and the absence of duplicates')
  const finalPayment = await Payment.findById(payment._id)
  const finalOrder = await Order.findById(order._id)
  const orderCount = await Order.countDocuments({ _id: order._id })
  const paymentCount = await Payment.countDocuments({ orderId: order._id })
  const capturedEvents = await PaymentEvent.countDocuments({ paymentId: payment._id, type: 'PAYMENT_CAPTURED' })
  const webhookEvents = await WebhookEvent.find({ eventId })
  const processedWebhooks = webhookEvents.filter((event) => event.status === 'PROCESSED')

  check('payment recovered to CAPTURED', finalPayment.status === 'CAPTURED', `status=${finalPayment.status}`)
  check('order recovered to PAID', finalOrder.status === 'PAID', `status=${finalOrder.status}`)
  check('order paymentStatus is CAPTURED', finalOrder.paymentStatus === 'CAPTURED', `paymentStatus=${finalOrder.paymentStatus}`)
  check('exactly 1 Order', orderCount === 1, `count=${orderCount}`)
  check('exactly 1 Payment for the order', paymentCount === 1, `count=${paymentCount}`)
  check('exactly 1 PAYMENT_CAPTURED event', capturedEvents === 1, `count=${capturedEvents}`)
  check('exactly 1 WebhookEvent for the event ID', webhookEvents.length === 1, `count=${webhookEvents.length}`)
  check('exactly 1 processed WebhookEvent', processedWebhooks.length === 1, `count=${processedWebhooks.length}`)

  if (shouldCleanup && source.createdBySimulation) {
    step('STEP 6 — Cleanup of simulation-created records')
    await PaymentEvent.deleteMany({ orderId: order._id })
    await WebhookEvent.deleteMany({ eventId })
    await Payment.deleteMany({ orderId: order._id })
    await Order.deleteOne({ _id: order._id })
    console.log('  Simulation records removed.')
  } else if (shouldCleanup) {
    step('STEP 6 — Cleanup skipped')
    console.log('  Refusing to delete records this simulation did not create.')
  }

  const failed = results.filter((result) => !result.passed)
  step(failed.length === 0 ? `RESULT — recovery verified with no duplicates (${results.length}/${results.length} checks passed)` : `RESULT — ${failed.length} of ${results.length} checks FAILED`)
  if (failed.length === 0 && !shouldCleanup) console.log(`  Inspect in the UI with payment reference ${payment._id}`)
  return failed.length === 0
}

try {
  const passed = await run()
  process.exitCode = passed ? 0 : 1
} catch (error) {
  console.error(`\nSimulation could not complete: ${error.message}`)
  if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) console.error(`Is the API running and reachable at ${endpoint}? Start it with: npm run dev`)
  process.exitCode = 1
} finally {
  await disconnectFromDatabase()
}
