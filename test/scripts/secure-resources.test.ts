import { describe, expect, it, vi } from 'vitest'
import { secureResources } from '../../scripts/production/secure-resources.mjs'

const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'secret',
  NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-production',
  NUXT_CLOUDFLARE_CUSTOM_DOMAIN: 'library.example.com',
  NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://household.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_POLICY_ID: '12345678-1234-1234-1234-123456789abc'
}
const aud = 'b'.repeat(64)
const matchingApp = {
  id: 'app-id', aud, name: 'libroo-production', type: 'self_hosted',
  domain: env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN,
  destinations: [{ type: 'public', uri: env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN, extra: 'server metadata' }],
  policies: [{ id: env.CLOUDFLARE_ACCESS_POLICY_ID, precedence: 1, name: 'Household' }],
  app_launcher_visible: false, http_only_cookie_attribute: true,
  same_site_cookie_attribute: 'lax', session_duration: '24h'
}
function mockApi(results: unknown[]) {
  return vi.fn(async () => {
    if (!results.length) throw new Error('Unexpected request')
    return new Response(JSON.stringify({ success: true, result: results.shift() }))
  })
}

describe('production security setup', () => {
  it('disables public R2 access before creating an Access app linked to the operator-managed policy', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: true }, {}, { enabled: false }, { domains: [] }, [], { aud }])
    expect(await secureResources(env, request)).toEqual({ NUXT_CLOUDFLARE_ACCESS_AUDIENCE: aud, NUXT_CLOUDFLARE_ACCESS_ENABLED: 'true' })
    expect(request.mock.calls[2]).toEqual([expect.stringContaining('/domains/managed'), expect.objectContaining({ method: 'PUT', body: '{"enabled":false}' })])
    expect(request.mock.calls.at(-1)).toEqual([expect.stringContaining('/access/apps'), expect.objectContaining({
      method: 'POST', body: expect.stringContaining(`"policies":[{"id":"${env.CLOUDFLARE_ACCESS_POLICY_ID}","precedence":1}]`)
    })])
  })

  it('updates its existing app instead of creating duplicates', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: false }, { domains: [] }, [{ name: 'libroo-production', id: 'app-id', domain: env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN }], { ...matchingApp, session_duration: '12h' }, { aud }])
    await secureResources(env, request)
    expect(request.mock.calls.at(-1)).toEqual([expect.stringContaining('/access/apps/app-id'), expect.objectContaining({ method: 'PUT' })])
  })

  it('makes no writes on repeated runs when the bucket and Access app already match', async () => {
    for (let run = 0; run < 2; run++) {
      const request = mockApi([{ decision: 'allow' }, { enabled: false }, { domains: [] }, [matchingApp], matchingApp])
      expect(await secureResources(env, request)).toEqual({ NUXT_CLOUDFLARE_ACCESS_AUDIENCE: aud, NUXT_CLOUDFLARE_ACCESS_ENABLED: 'true' })
      expect(request.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
    }
  })

  it('removes an unexpected attached Access policy instead of treating it as unchanged', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: false }, { domains: [] }, [{ name: 'libroo-production', id: 'app-id' }], {
      ...matchingApp,
      policies: [{ id: env.CLOUDFLARE_ACCESS_POLICY_ID, precedence: 1 }, { id: 'unexpected' }]
    }, { aud }])
    await secureResources(env, request)
    expect(request.mock.calls.at(-1)?.[1].method).toBe('PUT')
  })

  it('blocks deployment when a bucket custom domain is public', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: false }, { domains: [{ enabled: true }] }])
    await expect(secureResources(env, request)).rejects.toThrow('publicly accessible')
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('blocks deployment when disabling r2.dev did not take effect', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: true }, {}, { enabled: true }, { domains: [] }])
    await expect(secureResources(env, request)).rejects.toThrow('publicly accessible')
  })

  it('rejects a missing policy ID before making changes', async () => {
    const request = mockApi([])
    await expect(secureResources({ ...env, CLOUDFLARE_ACCESS_POLICY_ID: '' }, request)).rejects.toThrow('reusable Allow policy')
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a differently named application protecting the same host', async () => {
    const request = mockApi([{ decision: 'allow' }, { enabled: false }, { domains: [] }, [{ name: 'other', domain: env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN }]])
    await expect(secureResources(env, request)).rejects.toThrow('Another Access application')
  })
})
