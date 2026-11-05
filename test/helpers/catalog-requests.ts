import type { CatalogRequestState, CatalogClaim, CatalogProvider } from '../../server/repositories/catalog-request.repository'

/** Deterministic service test double; atomic SQL admission is tested separately on D1. */
export function memoryCatalogState(time = Date.parse('2026-11-04T10:00:00Z'), robotsText: string | null = '', providers: string[] = ['example', 'other']) {
  let clock = time
  const rows = new Map<CatalogProvider, CatalogRequestState>()
  for (const provider of providers) rows.set(provider, {
    provider, leaseId: null, leaseExpiresAt: 0, lastRequestAt: 0, nextRequestAt: 0,
    cooldownUntil: 0, failures: 0, dayStart: 0, dailyCount: 0,
    robotsText, robotsExpiresAt: robotsText === null ? 0 : clock + 86_400_000
  })
  const repository = {
    get: async (provider: CatalogProvider) => ({ ...rows.get(provider)! }),
    claim: async (input: CatalogClaim) => {
      const row = rows.get(input.provider)!
      if (row.cooldownUntil > input.now || row.leaseExpiresAt > input.now || row.nextRequestAt > input.now
        || row.lastRequestAt + input.spacingMs > input.now || (row.dayStart === input.dayStart && row.dailyCount >= input.dailyLimit)) return null
      Object.assign(row, {
        leaseId: input.leaseId, leaseExpiresAt: input.now + input.leaseMs, lastRequestAt: input.now,
        nextRequestAt: input.now + input.spacingMs, dayStart: input.dayStart,
        dailyCount: row.dayStart === input.dayStart ? row.dailyCount + 1 : 1
      })
      return { ...row }
    },
    complete: async (provider: CatalogProvider, leaseId: string, cooldownUntil: number, failed: boolean) => {
      const row = rows.get(provider)!
      if (row.leaseId !== leaseId && !failed) return
      if (row.leaseId === leaseId) Object.assign(row, { leaseId: null, leaseExpiresAt: 0 })
      Object.assign(row, { cooldownUntil: Math.max(row.cooldownUntil, cooldownUntil), failures: failed ? Math.min(row.failures + 1, 10) : 0 })
    },
    saveRobots: async (provider: CatalogProvider, text: string, expiresAt: number) => {
      Object.assign(rows.get(provider)!, { robotsText: text, robotsExpiresAt: expiresAt })
    }
  }
  return {
    repository, rows, now: () => clock,
    advance: (ms: number) => { clock += ms },
    wait: async (ms: number) => { clock += ms }
  }
}
