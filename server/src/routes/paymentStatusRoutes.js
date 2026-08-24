import { Router } from 'express'
import { getOrderStatusById, getPaymentStatusById } from '../controllers/paymentStatusController.js'

const router = Router()
router.get('/payments/:paymentId/status', getPaymentStatusById)
router.get('/orders/:orderId/status', getOrderStatusById)

export default router
