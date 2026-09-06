import { AppError } from '../utils/AppError.js'

// Responses expose a message only. Stack traces, driver errors, HMAC signatures, gateway payloads
// and configuration values never reach the client: anything that is not an AppError collapses to a
// single generic 500 message.
export function errorHandler(error, request, response, _next) {
  const statusCode = error.type === 'entity.too.large' ? 413 : error instanceof AppError ? error.statusCode : 500
  const message = error.type === 'entity.too.large' ? 'Request payload is too large.'
    : error instanceof SyntaxError && error.status === 400 ? 'Invalid JSON payload.'
      : error instanceof AppError ? error.message : 'An unexpected server error occurred.'

  // Unexpected failures were previously silent, leaving production with no signal at all. Only the
  // method, route path and error name are recorded — never the request body, query string, headers,
  // or error message, any of which can carry customer or payment data.
  if (statusCode >= 500) console.error(`PayGuard request failed: ${request.method} ${request.route?.path || request.path} (${error.name || 'Error'})`)

  response.status(statusCode).json({ error: { message } })
}
