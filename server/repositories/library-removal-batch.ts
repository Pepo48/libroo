import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm'
import { userBooks } from 'hub:db:schema'
import type { DbServiceInterface } from '../services/db.service'

// Explicit SQL aliases preserve the correlation in single-table SELECTs.
export const hasActiveLibraryLoan = sql<number>`exists(select 1 from loans as active_loan where active_loan.user_book_id = user_books.id and active_loan.status = 'active')`

/** Guarded, retry-safe removal with fewer than 100 parameters per statement. */
export async function removeLibraryRecords(database: DbServiceInterface, userId: string, inputIds: string[]) {
  const ids = [...new Set(inputIds)]
  const removed: string[] = []
  for (let offset = 0; offset < ids.length; offset += 90) {
    const chunk = ids.slice(offset, offset + 90)
    const results = await database.executeAtomic(db => [
      db.update(userBooks).set({ removedAt: new Date() }).where(and(
        eq(userBooks.userId, userId), isNull(userBooks.removedAt), inArray(userBooks.id, chunk), sql`not (${hasActiveLibraryLoan})`
      )),
      // A lost response can be retried: previously removed owned IDs are acknowledged.
      db.select({ id: userBooks.id }).from(userBooks).where(and(
        eq(userBooks.userId, userId), inArray(userBooks.id, chunk), isNotNull(userBooks.removedAt)
      ))
    ])
    removed.push(...(results[1] as { id: string }[]).map(row => row.id))
  }
  return removed
}
