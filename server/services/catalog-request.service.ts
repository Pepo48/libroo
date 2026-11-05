import { Context, Data, Effect, Layer } from 'effect'
import robotsParser from 'robots-parser'
import { CatalogRequestRepository } from '../repositories/catalog-request.repository'
import { makeCatalogHttpRepository } from '../repositories/catalog-http.repository'

/** Trusted server-side plugin configuration, never a URL supplied by a client. */
export interface CatalogTarget {
  id: string
  origin: string
  spacingMs?: number
  dailyLimit?: number
}
const USER_AGENT = 'Libroo/1.0 (personal library ISBN lookup)'
const DAY_MS = 86_400_000
const ROBOTS_TTL_MS = DAY_MS

export class CatalogRequestError extends Data.TaggedError('CatalogRequestError')<{
  message: string
  retryAt?: number
}> {}

type Repository = CatalogRequestRepository['Service']
type Transport = ReturnType<typeof makeCatalogHttpRepository>
export type CatalogGet = (provider: CatalogTarget, path: string, signal: AbortSignal) => Promise<{ text: string, url: string }>

export type CatalogGetImage = (provider: CatalogTarget, path: string, signal: AbortSignal) => Promise<ArrayBuffer | null>

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function retryAfterUntil(value: string | null, now: number): number {
  if (!value) return 0
  const delay = /^\d+$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value)
  return Number.isSafeInteger(delay) && delay > now ? delay : 0
}

export function makeCatalogRequestService(repository: Repository, transport: Transport, options: {
  now?: () => number
  wait?: typeof sleep
  random?: () => number
  config?: (target: CatalogTarget) => { spacingMs: number, dailyLimit: number }
} = {}) {
  const now = options.now ?? Date.now
  const wait = options.wait ?? sleep
  const random = options.random ?? Math.random
  const config = options.config ?? ((target: CatalogTarget) => ({ spacingMs: target.spacingMs ?? 2000, dailyLimit: target.dailyLimit ?? 100 }))

  function validate(provider: CatalogTarget, path: string) {
    const origin = new URL(provider.origin)
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) || origin.protocol !== 'https:' || origin.origin !== provider.origin) throw new CatalogRequestError({ message: 'Invalid catalog target configuration' })
    const url = new URL(path, origin)
    if (url.origin !== origin.origin || url.username || url.password) throw new CatalogRequestError({ message: 'Unexpected catalog redirect' })
    return url
  }

  async function acquire(provider: CatalogTarget, spacingMs: number, signal: AbortSignal) {
    const started = now()
    // Never leave a foreground request waiting through an upstream cooldown.
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted()
      const time = now()
      const dayStart = Math.floor(time / DAY_MS) * DAY_MS
      const leaseId = crypto.randomUUID()
      const state = await repository.claim({ provider: provider.id, leaseId, now: time, leaseMs: 15_000, spacingMs, dayStart, dailyLimit: config(provider).dailyLimit })
      if (state) return { ...state, leaseId }
      const current = await repository.get(provider.id)
      if (!current) throw new CatalogRequestError({ message: 'Catalog request admission unavailable' })
      if (current.cooldownUntil > time) throw new CatalogRequestError({ message: `${provider.id} is cooling down`, retryAt: current.cooldownUntil })
      if (current.dayStart === dayStart && current.dailyCount >= config(provider).dailyLimit) throw new CatalogRequestError({ message: `${provider.id} daily request budget reached`, retryAt: dayStart + DAY_MS })
      if (current.leaseExpiresAt > time) throw new CatalogRequestError({ message: `${provider.id} already has an active request`, retryAt: current.leaseExpiresAt })
      const retryAt = Math.max(current.nextRequestAt, current.lastRequestAt + spacingMs)
      const delay = Math.max(1, retryAt - time)
      if (now() - started + delay > 8000) throw new CatalogRequestError({ message: `${provider.id} request deferred`, retryAt })
      await wait(delay, signal)
    }
    throw new CatalogRequestError({ message: `${provider.id} request contention` })
  }

  async function read(provider: CatalogTarget, url: URL, spacingMs: number, signal: AbortSignal, image: boolean) {
    const permit = await acquire(provider, spacingMs, signal)
    const startedAt = now()
    const timeout = AbortSignal.timeout(5000)
    const resource = url.pathname === '/robots.txt' ? 'robots' : image ? 'cover' : 'metadata'
    let response: Awaited<ReturnType<Transport['read']>>
    try {
      response = await transport.read(url.href, USER_AGENT, AbortSignal.any([signal, timeout]), image)
    } catch (error) {
      // Persist the failure before returning; a cold start must not trigger retries.
      const cooldownUntil = now() + Math.min(30_000 * 2 ** permit.failures, 900_000)
      await repository.complete(provider.id, permit.leaseId, cooldownUntil, true)
      console.warn('Catalog request entered cooldown', {
        provider: provider.id,
        resource,
        reason: timeout.aborted ? 'timeout' : signal.aborted ? 'aborted' : 'transport_error',
        errorType: error instanceof Error ? error.name : 'unknown',
        elapsedMs: now() - startedAt,
        cooldownUntil
      })
      throw error
    }
    const challenge = response.headers.get('cf-mitigated') === 'challenge'
      || /<title[^>]*>\s*(?:Just a moment|Access denied|Attention Required|Verify (?:you are|that you are)|Captcha)/i.test(response.text)
      || /(?:id=["']cf-chl-|\/challenge-platform\/\S*orchestrate\/chl_page)/i.test(response.text)
    const blocked = response.status === 401 || response.status === 403 || challenge
    const failed = blocked || response.status === 429 || response.status >= 500
    let cooldownUntil = 0
    if (failed) {
      const base = blocked ? 900_000 : response.status === 429 ? 60_000 : 30_000
      const ceiling = blocked ? DAY_MS : response.status === 429 ? 3_600_000 : 900_000
      cooldownUntil = Math.max(now() + Math.min(base * 2 ** permit.failures, ceiling), retryAfterUntil(response.headers.get('retry-after'), now()))
    }
    await repository.complete(provider.id, permit.leaseId, cooldownUntil, failed)
    if (failed) {
      console.warn('Catalog request entered cooldown', {
        provider: provider.id,
        resource,
        reason: challenge ? 'challenge' : blocked ? 'access_denied' : response.status === 429 ? 'rate_limited' : 'upstream_error',
        status: response.status,
        elapsedMs: now() - startedAt,
        cooldownUntil
      })
      throw new CatalogRequestError({ message: `${provider.id} blocked or unavailable (HTTP ${response.status})`, retryAt: cooldownUntil })
    }
    return response
  }

  async function fetchPath(provider: CatalogTarget, path: string, signal: AbortSignal, spacingMs: number, allowed?: (url: string) => boolean, image = false) {
    let url = validate(provider, path)
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (allowed && !allowed(url.href)) throw new CatalogRequestError({ message: `${provider.id} robots.txt disallows this URL` })
      const response = await read(provider, url, spacingMs + Math.floor(random() * 251), signal, image)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new CatalogRequestError({ message: 'Missing catalog redirect location' })
        url = validate(provider, new URL(location, url).href)
        continue
      }
      if (response.status === 404 || response.status === 410) return { text: '', url: url.href, image: null }
      if (response.status !== 200) throw new CatalogRequestError({ message: `Catalog HTTP ${response.status}` })
      return { text: response.text, url: url.href, image: response.image ?? null }
    }
    throw new CatalogRequestError({ message: 'Too many catalog redirects' })
  }

  async function getResource(provider: CatalogTarget, path: string, signal: AbortSignal, image = false) {
    validate(provider, path)
    let state = await repository.get(provider.id)
    if (!state || state.robotsExpiresAt <= now()) {
      const robots = await fetchPath(provider, '/robots.txt', signal, config(provider).spacingMs)
      const invalid = robots.text.trimStart().startsWith('<')
      const text = invalid ? 'User-agent: *\nDisallow: /' : robots.text
      await repository.saveRobots(provider.id, text, now() + (invalid ? 900_000 : ROBOTS_TTL_MS))
      state = await repository.get(provider.id)
      if (!state) throw new CatalogRequestError({ message: 'Catalog robots policy unavailable' })
    }
    const robots = robotsParser(`${provider.origin}/robots.txt`, state.robotsText ?? '')
    const crawlDelay = robots.getCrawlDelay('Libroo')
    const spacingMs = Math.max(config(provider).spacingMs, Number.isFinite(crawlDelay) ? Math.ceil(crawlDelay! * 1000) : 0)
    return fetchPath(provider, path, signal, spacingMs, url => robots.isAllowed(url, 'Libroo') === true, image)
  }
  const get: CatalogGet = async (provider, path, signal) => {
    const { text, url } = await getResource(provider, path, signal)
    return { text, url }
  }
  const getImage: CatalogGetImage = async (provider, path, signal) =>
    (await getResource(provider, path, signal, true)).image
  return { get, getImage }
}

export class CatalogRequestService extends Context.Service<CatalogRequestService, ReturnType<typeof makeCatalogRequestService>>()('CatalogRequestService') {}
export const CatalogRequestServiceLive = Layer.effect(CatalogRequestService, Effect.gen(function* () {
  const repository = yield* CatalogRequestRepository
  return makeCatalogRequestService(repository, makeCatalogHttpRepository())
}))
