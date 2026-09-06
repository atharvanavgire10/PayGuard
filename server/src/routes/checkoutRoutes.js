import { Router } from 'express'
import { createOrder, verifyPayment } from '../controllers/checkoutController.js'
import { createSensitiveRateLimiter } from '../middleware/rateLimiters.js'
import { validateRequestBody } from '../middleware/validateRequest.js'
import { checkoutOrderRequestSchema, paymentVerificationRequestSchema } from '../validators/paymentRequestValidators.js'
const router = Router()
router.post('/orders', createSensitiveRateLimiter(), validateRequestBody(checkoutOrderRequestSchema), createOrder)
router.post('/payments/verify', createSensitiveRateLimiter(), validateRequestBody(paymentVerificationRequestSchema), verifyPayment)
export default router
