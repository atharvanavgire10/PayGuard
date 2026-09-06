import express from 'express'
import request from 'supertest'
import app from '../src/app.js'
import { createSensitiveRateLimiter } from '../src/middleware/rateLimiters.js'
import { errorHandler } from '../src/middleware/errorHandler.js'

describe('API security middleware', () => {
  it('sets security headers and disables framework disclosure', async () => {
    const response = await request(app).get('/api/health')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('rejects JSON bodies larger than the safe payload limit', async () => {
    const response = await request(app).post('/api/orders').send({ customer: { name: 'Test', email: 'test@example.com' }, items: [{ sku: 'payguard-demo-order', quantity: 1 }], padding: 'x'.repeat(1024 * 101) })
    expect(response.status).toBe(413)
    expect(response.body).toEqual({ error: { message: 'Request payload is too large.' } })
  })

  it('returns a safe 404 when development-only reconciliation is requested outside development', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const response = await request(app).post('/api/reconciliation/run')
    process.env.NODE_ENV = previous
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: { message: 'Not found.' } })
  })

  it('rate-limits sensitive requests with a safe response', async () => {
    const testApp = express()
    testApp.post('/sensitive', createSensitiveRateLimiter({ windowMs: 60 * 1000, max: 1 }), (_request, response) => response.status(204).end())
    testApp.use(errorHandler)
    expect((await request(testApp).post('/sensitive')).status).toBe(204)
    const blocked = await request(testApp).post('/sensitive')
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: { message: 'Too many requests. Please try again shortly.' } })
  })
})
