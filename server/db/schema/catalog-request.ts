import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One shared outbound request state per catalog, never per user or ISBN. */
export const catalogRequestState = sqliteTable('catalog_request_state', {
  provider: text('provider').primaryKey(),
  leaseId: text('lease_id'),
  leaseExpiresAt: integer('lease_expires_at').notNull().default(0),
  lastRequestAt: integer('last_request_at').notNull().default(0),
  nextRequestAt: integer('next_request_at').notNull().default(0),
  cooldownUntil: integer('cooldown_until').notNull().default(0),
  failures: integer('failures').notNull().default(0),
  dayStart: integer('day_start').notNull().default(0),
  dailyCount: integer('daily_count').notNull().default(0),
  robotsText: text('robots_text'),
  robotsExpiresAt: integer('robots_expires_at').notNull().default(0)
})
