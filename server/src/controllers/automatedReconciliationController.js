import { runAutomatedReconciliation } from '../services/payment/automatedReconciliationService.js'

export async function runReconciliation(_request, response, next) {
  try { response.status(200).json(await runAutomatedReconciliation()) } catch (error) { next(error) }
}
