import { Router } from 'express'
import { createOrder, verifyPayment } from '../controllers/checkoutController.js'
const router = Router()
router.post('/orders', createOrder)
router.post('/payments/verify', verifyPayment)
export default router
