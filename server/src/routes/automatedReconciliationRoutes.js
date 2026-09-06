import { Router } from 'express'
import { runReconciliation } from '../controllers/automatedReconciliationController.js'
import { requireDevelopment } from '../middleware/requireDevelopment.js'

const router = Router()
router.post('/reconciliation/run', requireDevelopment, runReconciliation)
export default router
