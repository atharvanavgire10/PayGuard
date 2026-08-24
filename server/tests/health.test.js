import request from 'supertest'
import app from '../src/app.js'

describe('GET /api/health', () => {
  it('returns the service health status', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', service: 'payguard-api', database: 'disconnected' })
  })
})
