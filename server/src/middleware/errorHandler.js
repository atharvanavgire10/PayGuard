import { AppError } from '../utils/AppError.js'

export function errorHandler(error, _request, response, _next) {
  const statusCode = error.type === 'entity.too.large' ? 413 : error instanceof AppError ? error.statusCode : 500
  const message = error.type === 'entity.too.large' ? 'Request payload is too large.'
    : error instanceof SyntaxError && error.status === 400 ? 'Invalid JSON payload.'
      : error instanceof AppError ? error.message : 'An unexpected server error occurred.'
  response.status(statusCode).json({ error: { message } })
}
