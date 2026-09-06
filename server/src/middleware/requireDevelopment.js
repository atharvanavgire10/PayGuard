import { AppError } from '../utils/AppError.js'

// The Phase 14 dashboard reads authoritative merchant data and has no authentication yet.
// Rather than ship a fake auth system, the whole surface is unavailable outside development.
export function requireDevelopment(_request, _response, next) {
  if (process.env.NODE_ENV !== 'development') return next(new AppError(404, 'Not found.'))
  next()
}
