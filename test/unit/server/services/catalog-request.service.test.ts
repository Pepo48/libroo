import { describe, expect, it, vi } from 'vitest'
import { makeCatalogHttpRepository } from '../../../../server/repositories/catalog-http.repository'
import { makeCatalogRequestService, retryAfterUntil } from '../../../../server/services/catalog-request.service'
import { memoryCatalogState } from '../../../helpers/catalog-requests'

const url = '/sck01/Search/Results?lookfor=9788055135465&type=ISN'
function setup(pages: Array<Response | string>, robots: string | null = '', dailyLimit = 100) {
  const state = memoryCatalogState(undefined, robots)
  const starts: number[] = []
  const request = vi.fn<typeof fetch>(async () => {
    starts.push(state.now())
    const page = pages.shift()
    if (page === undefined) throw new Error('Unexpected HTTP request')
    return typeof page === 'string' ? new Response(page) : page
  })
  const options = { now: state.now, wait: state.wait, random: () => 0, config: () => ({ spacingMs: 2000, dailyLimit }) }
  const client = () => makeCatalogRequestService(state.repository, makeCatalogHttpRepository(request), options)
  const get = (path = url) => client().get({ id: 'example', origin: 'https://catalog.example' }, path, AbortSignal.timeout(1000))
  return { ...state, client, get, request, starts }
}

describe('shared catalog request policy', () => {
  it('spaces requests across independently constructed clients', async () => {
    const { client, starts } = setup(['first', 'second'])
    await client().get({ id: 'example', origin: 'https://catalog.example' }, url, AbortSignal.timeout(1000))
    await client().get({ id: 'example', origin: 'https://catalog.example' }, url, AbortSignal.timeout(1000))
    expect(starts[1]! - starts[0]!).toBe(2000)
  })

  it('counts cover downloads against the same provider budget as metadata', async () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const { client, get, starts, request } = setup(['record', new Response(jpeg)], '', 2)
    const target = { id: 'example', origin: 'https://catalog.example' }
    await get()
    const image = await client().getImage(target, '/cover', AbortSignal.timeout(1000))
    expect(image).toEqual(jpeg.buffer)
    expect(starts[1]! - starts[0]!).toBe(2000)
    await expect(get()).rejects.toThrow('daily request budget')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('holds the global lease until the response body finishes', async () => {
    let finish!: () => void
    const stream = new ReadableStream({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode('done'))
          controller.close()
        }
      }
    })
    const { get, request } = setup([new Response(stream)])
    const first = get()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await expect(get()).rejects.toThrow('active request')
    expect(request).toHaveBeenCalledTimes(1)
    finish()
    expect(await first).toMatchObject({ text: 'done' })
  })

  it('enforces a UTC daily request budget without counting denied attempts', async () => {
    const { get, request, rows, advance } = setup(['one', 'two', 'User-agent: *', 'next day'], '', 2)
    await get()
    await get()
    await expect(get()).rejects.toThrow('daily request budget')
    expect(rows.get('example')?.dailyCount).toBe(2)
    expect(request).toHaveBeenCalledTimes(2)
    advance(86_400_000)
    await get()
    expect(rows.get('example')?.dailyCount).toBe(2) // Robots refresh also consumes a request.
  })

  it('persists 429 cooldowns and Retry-After across new client instances', async () => {
    const { get, request, advance, rows, now } = setup([new Response(null, { status: 429, headers: { 'retry-after': '120' } }), 'recovered'])
    const started = now()
    await expect(get()).rejects.toThrow('429')
    expect(rows.get('example')?.cooldownUntil).toBe(started + 120_000)
    await expect(get()).rejects.toThrow('cooling down')
    expect(request).toHaveBeenCalledTimes(1)
    advance(120_000)
    await get()
    expect(rows.get('example')?.failures).toBe(0)
  })

  it('increases cooldowns after repeated throttling', async () => {
    const { get, advance, rows, now } = setup([new Response(null, { status: 429 }), new Response(null, { status: 429 })])
    await expect(get()).rejects.toThrow('429')
    advance(60_000)
    await expect(get()).rejects.toThrow('429')
    expect(rows.get('example')?.cooldownUntil).toBe(now() + 120_000)
  })

  it.each([
    [403, '', {}],
    [200, '<title>Just a moment...</title>', {}],
    [200, 'challenge', { 'cf-mitigated': 'challenge' }]
  ])('stops after an access block/challenge (%s)', async (status, text, headers) => {
    const { get, request, rows, now } = setup([new Response(text, { status: Number(status), headers: headers as HeadersInit })])
    await expect(get()).rejects.toThrow('blocked')
    expect(rows.get('example')?.cooldownUntil).toBe(now() + 900_000)
    await expect(get()).rejects.toThrow('cooling down')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the database cannot authorize a request', async () => {
    const { client, repository, request } = setup(['not sent'])
    vi.spyOn(repository, 'claim').mockRejectedValue(new Error('database offline'))
    await expect(client().get({ id: 'example', origin: 'https://catalog.example' }, url, AbortSignal.timeout(1000))).rejects.toThrow('database offline')
    expect(request).not.toHaveBeenCalled()
  })

  it('recovers an abandoned lease after expiry', async () => {
    const { get, rows, advance, now, request } = setup(['recovered'])
    rows.get('example')!.leaseExpiresAt = now() + 15_000
    await expect(get()).rejects.toThrow('active request')
    expect(request).not.toHaveBeenCalled()
    advance(15_000)
    await get()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not let one provider cooldown block the other', async () => {
    const { client } = setup([new Response(null, { status: 403 }), 'other provider'])
    await expect(client().get({ id: 'example', origin: 'https://catalog.example' }, url, AbortSignal.timeout(1000))).rejects.toThrow('403')
    expect(await client().get({ id: 'other', origin: 'https://other.example' }, '/search?q=isbn', AbortSignal.timeout(1000))).toMatchObject({ text: 'other provider' })
  })
})

describe('catalog robots policy and redirects', () => {
  it('fetches and persists robots.txt once, counting it in the daily budget', async () => {
    const { get, request, rows, starts } = setup(['User-agent: *\nDisallow: /sck01/private', 'one', 'two'], null)
    await get()
    await get()
    expect(request.mock.calls.map(call => call[0])).toEqual(['https://catalog.example/robots.txt', `https://catalog.example${url}`, `https://catalog.example${url}`])
    expect(rows.get('example')?.dailyCount).toBe(3)
    expect(starts[1]! - starts[0]!).toBe(2000)
  })

  it('checks robots rules before sending a disallowed lookup', async () => {
    const { get, request } = setup(['User-agent: Libroo\nDisallow: /sck01/Search'], null)
    await expect(get()).rejects.toThrow('robots.txt disallows')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('honors a longer published Crawl-delay', async () => {
    const { get, starts } = setup(['User-agent: *\nCrawl-delay: 4', 'book'], null)
    await get()
    expect(starts[1]! - starts[0]!).toBe(4000)
  })

  it('skips a provider whose Crawl-delay exceeds the foreground wait budget', async () => {
    const { get, request } = setup(['User-agent: *\nCrawl-delay: 20'], null)
    await expect(get()).rejects.toThrow('deferred')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('allows a missing robots file, but stops when fetching it is blocked', async () => {
    const missing = setup([new Response(null, { status: 404 }), 'book'], null)
    expect(await missing.get()).toMatchObject({ text: 'book' })
    const denied = setup([new Response(null, { status: 403 })], null)
    await expect(denied.get()).rejects.toThrow('403')
    expect(denied.request).toHaveBeenCalledTimes(1)
  })

  it('does not treat an HTML robots response as permission to crawl', async () => {
    const { get, request } = setup(['<!doctype html><h1>Login required</h1>'], null)
    await expect(get()).rejects.toThrow('robots.txt disallows')
    await expect(get()).rejects.toThrow('robots.txt disallows')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('counts and spaces redirect hops, then checks the destination robots rules', async () => {
    const { get, request, starts } = setup([new Response(null, { status: 302, headers: { location: '/sck01/Record/123' } }), 'book'])
    await get()
    expect(starts[1]! - starts[0]!).toBe(2000)
    const denied = setup([new Response(null, { status: 302, headers: { location: '/private' } })], 'User-agent: *\nDisallow: /private')
    await expect(denied.get()).rejects.toThrow('robots.txt disallows')
    expect(denied.request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('never sends a redirected request to an external origin', async () => {
    const { get, request } = setup([new Response(null, { status: 302, headers: { location: 'https://external.example' } })])
    await expect(get()).rejects.toThrow('Unexpected catalog redirect')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses a stable identifying user-agent without user cookies or authorization', async () => {
    const { get, request } = setup(['book'])
    await get()
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({ 'User-Agent': 'Libroo/1.0 (personal library ISBN lookup)', 'Accept': 'text/html, application/xml, text/plain' })
  })
})

describe('Retry-After parsing', () => {
  const now = Date.parse('2026-11-04T10:00:00Z')
  it('accepts seconds and future HTTP dates without shortening a long cooldown', () => {
    expect(retryAfterUntil('120', now)).toBe(now + 120_000)
    expect(retryAfterUntil(new Date(now + 3600_000).toUTCString(), now)).toBe(now + 3600_000)
  })
  it('ignores malformed, past and overflowing values', () => {
    for (const value of [null, 'invalid', '-1', '999999999999999999999999', new Date(now - 1000).toUTCString()]) expect(retryAfterUntil(value, now)).toBe(0)
  })
})
