import { Router } from 'express'
import { runReconciliation } from '../controllers/automatedReconciliationController.js'
import { requireDevelopment } from '../middleware/requireDevelopment.js'
import { createSensitiveRateLimiter } from '../middleware/rateLimiters.js'

const router = Router()
router.post('/reconciliation/run', requireDevelopment, createSensitiveRateLimiter({ max: 5 }), runReconciliation)
export default router
