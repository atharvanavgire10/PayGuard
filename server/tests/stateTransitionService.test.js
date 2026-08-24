import { assertOrderTransition, assertPaymentTransition } from '../src/services/payment/stateTransitionService.js'

describe('payment state transitions', () => {
  it('allows a valid payment transition', () => {
    expect(assertPaymentTransition('PENDING', 'AUTHORIZED')).toBe('AUTHORIZED')
  })

  it('rejects an invalid payment transition', () => {
    expect(() => assertPaymentTransition('FAILED', 'CAPTURED')).toThrow('Invalid payment state transition')
  })

  it('allows a valid order transition and rejects a terminal transition', () => {
    expect(assertOrderTransition('PENDING_PAYMENT', 'PAID')).toBe('PAID')
    expect(() => assertOrderTransition('PAID', 'CANCELLED')).toThrow('Invalid order state transition')
  })
})
