import { Router } from 'express'
import { receiveRazorpayWebhook } from '../controllers/razorpayWebhookController.js'
import { createSensitiveRateLimiter } from '../middleware/rateLimiters.js'
const router = Router()
router.post('/', createSensitiveRateLimiter({ max: 60 }), receiveRazorpayWebhook)
export default router
