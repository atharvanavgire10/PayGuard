import { AppError } from '../utils/AppError.js'

export function validateRequestBody(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body)
    if (!result.success) return next(new AppError(400, 'Invalid request payload.'))
    request.body = result.data
    next()
  }
}
