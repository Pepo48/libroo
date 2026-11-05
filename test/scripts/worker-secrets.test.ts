import { describe, expect, it } from 'vitest'
import { buildWorkerSecrets } from '../../scripts/production/worker-secrets.mjs'

const base = {
  NUXT_BETTER_AUTH_SECRET: 'test-auth-secret',
  NUXT_OPEN_LIBRARY_CONTACT_EMAIL: 'operator@example.invalid',
  NUXT_EMAIL_VERIFICATION_ENABLED: 'false'
}

describe('production Worker secrets', () => {
  it('supports deployment without email and clears any previous Plunk key', () => {
    expect(buildWorkerSecrets(base)).toEqual({
      NUXT_BETTER_AUTH_SECRET: base.NUXT_BETTER_AUTH_SECRET,
      NUXT_OPEN_LIBRARY_CONTACT_EMAIL: base.NUXT_OPEN_LIBRARY_CONTACT_EMAIL,
      NUXT_PLUNK_API_KEY: null,
      NUXT_OIDC_CLIENT_SECRET: null
    })
  })

  it('syncs optional email delivery even when verification is disabled', () => {
    expect(buildWorkerSecrets({ ...base, NUXT_PLUNK_API_KEY: 'test-plunk-key', NUXT_EMAIL_FROM: 'library@example.invalid' }).NUXT_PLUNK_API_KEY).toBe('test-plunk-key')
  })

  it('rejects verification without delivery configuration', () => {
    expect(() => buildWorkerSecrets({ ...base, NUXT_EMAIL_VERIFICATION_ENABLED: 'true' })).toThrow('NUXT_EMAIL_FROM')
  })

  it('rejects a sender without a key', () => {
    expect(() => buildWorkerSecrets({ ...base, NUXT_EMAIL_FROM: 'library@example.invalid' })).toThrow('NUXT_PLUNK_API_KEY')
  })

  it('rejects a key without a sender', () => {
    expect(() => buildWorkerSecrets({ ...base, NUXT_PLUNK_API_KEY: 'test-plunk-key' })).toThrow('NUXT_EMAIL_FROM')
  })

  it('still requires credentials for enabled OIDC and Turnstile', () => {
    expect(() => buildWorkerSecrets({ ...base, NUXT_PUBLIC_OIDC_ENABLED: 'true' })).toThrow('NUXT_OIDC_CLIENT_SECRET')
    expect(() => buildWorkerSecrets({ ...base, NUXT_PUBLIC_TURNSTILE_ENABLED: 'true' })).toThrow('NUXT_TURNSTILE_SECRET_KEY')
  })

  it('still requires the auth secret and Open Library identification', () => {
    expect(() => buildWorkerSecrets({ ...base, NUXT_BETTER_AUTH_SECRET: '' })).toThrow('NUXT_BETTER_AUTH_SECRET')
    expect(() => buildWorkerSecrets({ ...base, NUXT_OPEN_LIBRARY_CONTACT_EMAIL: '' })).toThrow('NUXT_OPEN_LIBRARY_CONTACT_EMAIL')
  })
})
