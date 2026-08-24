export function errorHandler(error, _request, response, _next) {
  const statusCode = error.statusCode || 500
  const message = statusCode === 500 ? 'Unable to retrieve payment status.' : error.message
  response.status(statusCode).json({ error: { message } })
}
