import rateLimit from 'express-rate-limit'
import { AppError } from '../utils/AppError.js'

export function createSensitiveRateLimiter({ windowMs = 60 * 1000, max = 10 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, _response, next) => next(new AppError(429, 'Too many requests. Please try again shortly.')),
  })
}
