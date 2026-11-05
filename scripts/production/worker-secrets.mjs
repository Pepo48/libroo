import { pathToFileURL } from 'node:url'

export function buildWorkerSecrets(env = process.env) {
  const secretNames = ['NUXT_BETTER_AUTH_SECRET', 'NUXT_OPEN_LIBRARY_CONTACT_EMAIL']
  const hasValue = name => Boolean(env[name]?.trim())
  const emailConfigured = hasValue('NUXT_PLUNK_API_KEY') || hasValue('NUXT_EMAIL_FROM')
  if (emailConfigured || env.NUXT_EMAIL_VERIFICATION_ENABLED === 'true') {
    if (!hasValue('NUXT_EMAIL_FROM')) throw new Error('NUXT_EMAIL_FROM is required when email delivery or verification is enabled.')
    secretNames.push('NUXT_PLUNK_API_KEY')
  }
  if (env.NUXT_PUBLIC_TURNSTILE_ENABLED === 'true') secretNames.push('NUXT_TURNSTILE_SECRET_KEY')
  if (env.NUXT_PUBLIC_OIDC_ENABLED === 'true') secretNames.push('NUXT_OIDC_CLIENT_SECRET')
  const missing = secretNames.filter(name => !hasValue(name))
  if (missing.length) throw new Error(`Missing required Worker secrets: ${missing.join(', ')}`)
  const secrets = Object.fromEntries(secretNames.map(name => [name, env[name]]))
  if (!secretNames.includes('NUXT_PLUNK_API_KEY')) secrets.NUXT_PLUNK_API_KEY = null
  if (env.NUXT_PUBLIC_OIDC_ENABLED !== 'true') secrets.NUXT_OIDC_CLIENT_SECRET = null
  return secrets
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const secrets = buildWorkerSecrets()
    // Validation mode never prints credentials. Normal output goes directly to Wrangler.
    if (!process.argv.includes('--validate')) process.stdout.write(JSON.stringify(secrets))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
