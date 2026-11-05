import { Context, Effect, Layer } from 'effect'
import { and, eq, sql } from 'drizzle-orm'
import { catalogRequestState as state } from '../db/schema/catalog-request'
import { DbService, type DbServiceInterface } from '../services/db.service'

export type CatalogProvider = string
export type CatalogRequestState = typeof state.$inferSelect
export interface CatalogClaim {
  provider: CatalogProvider
  leaseId: string
  now: number
  leaseMs: number
  spacingMs: number
  dayStart: number
  dailyLimit: number
}

export function makeCatalogRequestRepository(database: DbServiceInterface) {
  return {
    get: async (provider: CatalogProvider) => (await database.db.select().from(state).where(eq(state.provider, provider)).limit(1))[0] ?? null,
    claim: async (input: CatalogClaim): Promise<CatalogRequestState | null> => {
      const { provider, leaseId, now, leaseMs, spacingMs, dayStart, dailyLimit } = input
      // Admission, budget consumption and lease acquisition are one atomic write.
      const result = await database.executeAtomic(db => [db.insert(state).values({
        provider, leaseId, leaseExpiresAt: now + leaseMs, lastRequestAt: now,
        nextRequestAt: now + spacingMs, dayStart, dailyCount: 1
      }).onConflictDoUpdate({
        target: state.provider,
        set: {
          leaseId, leaseExpiresAt: now + leaseMs, lastRequestAt: now, nextRequestAt: now + spacingMs, dayStart,
          dailyCount: sql`CASE WHEN ${state.dayStart} = ${dayStart} THEN ${state.dailyCount} + 1 ELSE 1 END`
        },
        setWhere: sql`${state.cooldownUntil} <= ${now}
          AND ${state.leaseExpiresAt} <= ${now}
          AND ${state.nextRequestAt} <= ${now}
          AND ${state.lastRequestAt} + ${spacingMs} <= ${now}
          AND (${state.dayStart} != ${dayStart} OR ${state.dailyCount} < ${dailyLimit})`
      }).returning()])
      return (result[0] as CatalogRequestState[])[0] ?? null
    },
    complete: async (provider: CatalogProvider, leaseId: string, cooldownUntil: number, failed: boolean) => {
      await database.db.update(state).set({
        // A late blocked response must still extend the provider cooldown, but
        // must never release another instance's newer lease.
        leaseId: sql`CASE WHEN ${state.leaseId} = ${leaseId} THEN NULL ELSE ${state.leaseId} END`,
        leaseExpiresAt: sql`CASE WHEN ${state.leaseId} = ${leaseId} THEN 0 ELSE ${state.leaseExpiresAt} END`,
        cooldownUntil: sql`max(${state.cooldownUntil}, ${cooldownUntil})`,
        failures: failed ? sql`min(${state.failures} + 1, 10)` : 0
      }).where(and(eq(state.provider, provider), failed ? sql`1 = 1` : eq(state.leaseId, leaseId)))
    },
    saveRobots: async (provider: CatalogProvider, text: string, expiresAt: number) => {
      await database.db.update(state).set({ robotsText: text, robotsExpiresAt: expiresAt }).where(eq(state.provider, provider))
    }
  }
}

export class CatalogRequestRepository extends Context.Service<CatalogRequestRepository, ReturnType<typeof makeCatalogRequestRepository>>()('CatalogRequestRepository') {}
export const CatalogRequestRepositoryLive = Layer.effect(CatalogRequestRepository, Effect.gen(function* () {
  return makeCatalogRequestRepository(yield* DbService)
}))
