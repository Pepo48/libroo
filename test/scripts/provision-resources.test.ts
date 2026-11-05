import { describe, expect, it, vi } from 'vitest'
import { provisionResources } from '../../scripts/production/provision-resources.mjs'

const uuid = '12345678-1234-1234-1234-123456789abc'
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-token' }
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }))

function mockApi(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected API request')
    return response
  })
}

describe('production resource provisioning', () => {
  it('reuses existing resources without mutation', async () => {
    const request = mockApi([ok([{ name: 'libroo-production', uuid }]), ok({ name: 'libroo-production' })])
    expect(await provisionResources(env, request)).toEqual({
      NUXT_HUB_CLOUDFLARE_DATABASE_ID: uuid,
      NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-production'
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('creates only the missing bucket with Standard storage', async () => {
    const request = mockApi([
      ok([{ name: 'libroo-production', uuid }]),
      new Response('', { status: 404 }), ok({})
    ])
    await provisionResources(env, request)
    expect(request.mock.calls.at(-1)).toEqual([
      expect.stringContaining('/r2/buckets'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'libroo-production', storageClass: 'Standard' }) })
    ])
  })

  it('creates both resources on an empty account', async () => {
    const request = mockApi([ok([]), new Response('', { status: 404 }), ok({ uuid }), ok({})])
    expect((await provisionResources(env, request)).NUXT_HUB_CLOUDFLARE_DATABASE_ID).toBe(uuid)
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('refuses a pinned database from another environment before creating anything', async () => {
    const request = mockApi([ok({ uuid, name: 'libroo-preview-pr-42' })])
    await expect(provisionResources({ ...env, NUXT_HUB_CLOUDFLARE_DATABASE_ID: uuid }, request)).rejects.toThrow('must be named libroo-production')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('fails on authorization errors instead of treating them as missing buckets', async () => {
    const request = mockApi([ok([]), new Response(JSON.stringify({ success: false }), { status: 403 })])
    await expect(provisionResources(env, request)).rejects.toThrow('HTTP 403')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('rejects missing credentials without calling Cloudflare', async () => {
    const request = mockApi([])
    await expect(provisionResources({}, request)).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID')
    expect(request).not.toHaveBeenCalled()
  })
})
