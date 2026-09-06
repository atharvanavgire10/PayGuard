// Startup configuration audit. Deliberately imported by server.js only, never by app.js, so the
// test suite keeps booting the Express app without a populated environment.
//
// Only variable NAMES are ever reported. Values are never logged, echoed, or included in errors,
// because the required set includes the Razorpay key secret and the webhook secret.

const REQUIRED_ALWAYS = ['MONGODB_URI']
const REQUIRED_IN_PRODUCTION = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'CLIENT_URL']

const present = (env, name) => typeof env[name] === 'string' && env[name].trim() !== ''

export function auditEnvironment(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development'
  const required = nodeEnv === 'production' ? [...REQUIRED_ALWAYS, ...REQUIRED_IN_PRODUCTION] : REQUIRED_ALWAYS
  const missing = required.filter((name) => !present(env, name))
  const warnings = []

  // PayGuard supports Razorpay Test Mode only; checkoutService already refuses a non-test key with
  // a 503. Surfacing it at boot turns a per-request failure into an obvious startup signal.
  if (present(env, 'RAZORPAY_KEY_ID') && !env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) warnings.push('RAZORPAY_KEY_ID is not a Test Mode key; checkout will refuse to create orders.')
  if (nodeEnv === 'production' && !present(env, 'CLIENT_URL')) warnings.push('CLIENT_URL is unset, so CORS falls back to the local development origin.')

  return { nodeEnv, missing, warnings, valid: missing.length === 0 }
}

// Throws with names only. A caller that logs error.message therefore cannot leak a secret value.
export function assertEnvironment(env = process.env) {
  const audit = auditEnvironment(env)
  if (!audit.valid) throw new Error(`Missing required environment variables: ${audit.missing.join(', ')}`)
  return audit
}
