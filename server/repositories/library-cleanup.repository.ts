import { Context, Effect, Layer } from 'effect'
import { and, eq, isNull } from 'drizzle-orm'
import { userBooks } from 'hub:db:schema'
import { DbService } from '../services/db.service'
import { DatabaseError } from './book.repository'

import { hasActiveLibraryLoan, removeLibraryRecords } from './library-removal-batch'

export class LibraryCleanupRepository extends Context.Service<LibraryCleanupRepository, {
  removalCandidates: (userId: string) => Effect.Effect<{ id: string, activeLoan: number }[], DatabaseError>
  removeChunk: (userId: string, ids: string[]) => Effect.Effect<string[], DatabaseError>
}>()('LibraryCleanupRepository') {}

export const LibraryCleanupRepositoryLive = Layer.effect(LibraryCleanupRepository, Effect.gen(function* () {
  const database = yield* DbService
  return {
    removalCandidates: (userId: string) => Effect.tryPromise({
      try: () => database.db.select({
        id: userBooks.id,
        activeLoan: hasActiveLibraryLoan
      }).from(userBooks).where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt))),
      catch: error => new DatabaseError({ message: `Unable to preview library removal: ${error}`, operation: 'libraryCleanup.removalCandidates' })
    }),
    removeChunk: (userId: string, ids: string[]) => Effect.tryPromise({
      try: () => removeLibraryRecords(database, userId, ids),
      catch: error => new DatabaseError({ message: `Unable to remove library records: ${error}`, operation: 'libraryCleanup.removeChunk' })
    })
  }
}))
