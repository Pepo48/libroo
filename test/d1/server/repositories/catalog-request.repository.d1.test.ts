/// <reference types="@cloudflare/vitest-plugin" />

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import migration from '../../../../server/db/migrations/sqlite/0021_catalog_request_controls.sql?raw'
import { catalogRequestState } from '../../../../server/db/schema/catalog-request'
import { makeCatalogRequestRepository, type CatalogClaim } from '../../../../server/repositories/catalog-request.repository'
import { makeCatalogRequestService } from '../../../../server/services/catalog-request.service'
import type { DbServiceInterface } from '../../../../server/services/db.service'

const now = Date.parse('2026-11-04T10:00:00Z')
const dayStart = Math.floor(now / 86_400_000) * 86_400_000

describe('atomic catalog admission on D1', () => {
  const database = drizzle(env.DB)
  const service: DbServiceInterface = {
    db: database as unknown as DbServiceInterface['db'],
    executeAtomic: (build) => {
      const db = database as unknown as DbServiceInterface['db']
      return db.batch(build(db))
    }
  }
  const repository = () => makeCatalogRequestRepository(service)
  const input = (overrides: Partial<CatalogClaim> = {}): CatalogClaim => ({
    provider: 'example', now, dayStart, leaseId: crypto.randomUUID(), leaseMs: 15_000, spacingMs: 2000, dailyLimit: 2, ...overrides
  })
  beforeAll(async () => {
    await env.DB.prepare(migration).run()
  })
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalog_request_state').run()
  })

  it('allows exactly one concurrent claim across separate repository instances', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => repository().claim(input())))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repository().get('example')).toMatchObject({ dailyCount: 1, leaseExpiresAt: now + 15_000 })
    expect(await repository().claim(input({ now: now + 2000 }))).toBeNull()
  })

  it('enforces spacing, daily budget and UTC rollover without charging denied claims', async () => {
    const first = input()
    await repository().claim(first)
    await repository().complete('example', first.leaseId, 0, false)
    expect(await repository().claim(input({ now: now + 1999 }))).toBeNull()
    const second = input({ now: now + 2000 })
    expect(await repository().claim(second)).not.toBeNull()
    await repository().complete('example', second.leaseId, 0, false)
    expect(await repository().claim(input({ now: now + 4000 }))).toBeNull()
    expect(await repository().get('example')).toMatchObject({ dailyCount: 2 })
    expect(await repository().claim(input({ now: dayStart + 86_400_000, dayStart: dayStart + 86_400_000 }))).toMatchObject({ dailyCount: 1 })
  })

  it('persists cooldowns across instances and preserves them over midnight', async () => {
    const first = input()
    await repository().claim(first)
    const until = dayStart + 2 * 86_400_000
    await repository().complete('example', first.leaseId, until, true)
    expect(await repository().claim(input({ now: dayStart + 86_400_000, dayStart: dayStart + 86_400_000 }))).toBeNull()
    expect(await repository().get('example')).toMatchObject({ cooldownUntil: until, failures: 1 })
  })

  it('fences late completions so they cannot release a newer lease', async () => {
    const first = input()
    await repository().claim(first)
    const second = input({ now: now + 15_000 })
    await repository().claim(second)
    await repository().complete('example', first.leaseId, 0, false)
    expect(await repository().get('example')).toMatchObject({ leaseId: second.leaseId, dailyCount: 2 })
    expect(await repository().claim(input({ now: now + 17_000, dailyLimit: 100 }))).toBeNull()
  })

  it('retains a late block without releasing a newer lease or letting its success clear the cooldown', async () => {
    const first = input()
    await repository().claim(first)
    const second = input({ now: now + 15_000 })
    await repository().claim(second)
    const until = now + 900_000
    await repository().complete('example', first.leaseId, until, true)
    expect(await repository().get('example')).toMatchObject({ leaseId: second.leaseId, cooldownUntil: until })
    await repository().complete('example', second.leaseId, 0, false)
    expect(await repository().claim(input({ now: now + 17_000, dailyLimit: 100 }))).toBeNull()
    expect(await repository().get('example')).toMatchObject({ cooldownUntil: until })
  })

  it('checks a longer robots Crawl-delay against the actual last request timestamp', async () => {
    const first = input()
    await repository().claim(first)
    await repository().complete('example', first.leaseId, 0, false)
    expect(await repository().claim(input({ now: now + 3000, spacingMs: 4000 }))).toBeNull()
    expect(await repository().claim(input({ now: now + 4000, spacingMs: 4000 }))).not.toBeNull()
  })

  it('shares robots and block decisions between independent HTTP services', async () => {
    await database.insert(catalogRequestState).values({ provider: 'example', robotsText: 'User-agent: *\nDisallow: /private', robotsExpiresAt: now + 86_400_000 })
    const read = vi.fn(async () => ({ status: 429, headers: new Headers({ 'Retry-After': '300' }), text: '' }))
    const client = () => makeCatalogRequestService(repository(), { read }, { now: () => now, random: () => 0 })
    await expect(client().get({ id: 'example', origin: 'https://catalog.example' }, '/sck01/Search/Results', AbortSignal.timeout(1000))).rejects.toThrow('429')
    await expect(client().get({ id: 'example', origin: 'https://catalog.example' }, '/sck01/Search/Results', AbortSignal.timeout(1000))).rejects.toThrow('cooling down')
    await expect(client().get({ id: 'example', origin: 'https://catalog.example' }, '/private', AbortSignal.timeout(1000))).rejects.toThrow('robots.txt disallows')
    expect(read).toHaveBeenCalledTimes(1)
    expect(await repository().get('example')).toMatchObject({ dailyCount: 1, cooldownUntil: now + 300_000 })
  })
})
