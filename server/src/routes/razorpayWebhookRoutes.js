import { Router } from 'express'
import { receiveRazorpayWebhook } from '../controllers/razorpayWebhookController.js'
const router = Router()
router.post('/', receiveRazorpayWebhook)
export default router
