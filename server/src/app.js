import cors from 'cors'
import express from 'express'
import healthRouter from './routes/healthRoutes.js'
import paymentStatusRouter from './routes/paymentStatusRoutes.js'
import checkoutRouter from './routes/checkoutRoutes.js'
import dashboardRouter from './routes/dashboardRoutes.js'
import razorpayWebhookRouter from './routes/razorpayWebhookRoutes.js'
import automatedReconciliationRouter from './routes/automatedReconciliationRoutes.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), razorpayWebhookRouter)
app.use(express.json())
app.use('/api/health', healthRouter)
app.use('/api', paymentStatusRouter)
app.use('/api', checkoutRouter)
app.use('/api', automatedReconciliationRouter)
app.use('/api', dashboardRouter)
app.use(errorHandler)

export default app
