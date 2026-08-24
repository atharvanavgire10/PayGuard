import { Router } from 'express'
import { getAttention, getPaymentReconciliation, getPayments, getSummary } from '../controllers/dashboardController.js'
import { requireDevelopment } from '../middleware/requireDevelopment.js'

const router = Router()
router.use('/dashboard', requireDevelopment)
router.get('/dashboard/summary', getSummary)
router.get('/dashboard/payments', getPayments)
router.get('/dashboard/attention', getAttention)
router.get('/dashboard/reconciliation/:paymentId', getPaymentReconciliation)

export default router
