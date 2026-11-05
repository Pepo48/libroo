import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verify: vi.fn(), config: { cloudflarePreview: '', cloudflareAccessEnabled: 'true', cloudflareAccessAudience: 'audience', cloudflareAccessTeamDomain: 'https://team.cloudflareaccess.com' } }))
vi.mock('../../../../server/utils/cloudflare-access', () => ({
  verifyCloudflareAccessJwt: mocks.verify,
  isCloudflareAccessTokenError: (error: unknown) => error instanceof TypeError
}))
vi.stubGlobal('useRuntimeConfig', () => mocks.config)
const { default: middleware } = await import('../../../../server/middleware/preview-access')
const { createEvent } = await import('h3')
const { IncomingMessage, ServerResponse } = await import('node:http')
const { Socket } = await import('node:net')
function event(token?: string) {
  const req = new IncomingMessage(new Socket())
  req.url = '/api/blob/covers/book.jpg'
  if (token) req.headers['cf-access-jwt-assertion'] = token
  return createEvent(req, new ServerResponse(req))
}

beforeEach(() => {
  mocks.verify.mockReset()
  mocks.config.cloudflareAccessEnabled = 'true'
  mocks.config.cloudflareAccessAudience = 'audience'
})

describe('production Access enforcement', () => {
  it('rejects direct requests without an Access JWT', async () => {
    await expect(middleware(event())).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('fails closed when protection is enabled without an audience', async () => {
    mocks.config.cloudflareAccessAudience = ''
    await expect(middleware(event('jwt'))).rejects.toMatchObject({ statusCode: 503 })
  })
  it('validates the Access JWT for production requests', async () => {
    mocks.verify.mockResolvedValue({ sub: 'owner' })
    const request = event('jwt')
    await middleware(request)
    expect(mocks.verify).toHaveBeenCalledWith({ token: 'jwt', audience: 'audience', teamDomain: mocks.config.cloudflareAccessTeamDomain })
    expect(request.context.cloudflareAccess).toEqual({ sub: 'owner' })
  })
  it('rejects invalid JWTs', async () => {
    mocks.verify.mockRejectedValue(new TypeError('invalid'))
    await expect(middleware(event('jwt'))).rejects.toMatchObject({ statusCode: 403 })
  })
  it('allows self-hosted deployments to omit Cloudflare Access', async () => {
    mocks.config.cloudflareAccessEnabled = ''
    await middleware(event())
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
