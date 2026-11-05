import { Context, Effect, Layer } from 'effect'
import { LibraryCleanupRepository } from '../repositories/library-cleanup.repository'
import type { LibraryRemovalPreview } from '../../shared/types/library-cleanup'

export class LibraryCleanupService extends Context.Service<LibraryCleanupService, {
  removalPreview: (userId: string) => Effect.Effect<LibraryRemovalPreview, import('../repositories/book.repository').DatabaseError>
  remove: (userId: string, ids: string[]) => Effect.Effect<{ removedIds: string[], failedIds: string[] }, import('../repositories/book.repository').DatabaseError>
}>()('LibraryCleanupService') {}

export const LibraryCleanupServiceLive = Layer.effect(LibraryCleanupService, Effect.gen(function* () {
  const repository = yield* LibraryCleanupRepository
  return {
    removalPreview: (userId: string) => repository.removalCandidates(userId).pipe(Effect.map(rows => ({
      total: rows.length, protectedLoanCount: rows.filter(row => row.activeLoan).length,
      ids: rows.filter(row => !row.activeLoan).map(row => row.id)
    }))),
    remove: (userId: string, inputIds: string[]) => Effect.gen(function* () {
      const ids = [...new Set(inputIds)]
      const removedIds = yield* repository.removeChunk(userId, ids)
      const removed = new Set(removedIds)
      return { removedIds, failedIds: ids.filter(id => !removed.has(id)) }
    })
  }
}))

export const batchRemoveFromLibrary = (ids: string[], userId: string) =>
  Effect.flatMap(LibraryCleanupService, service => service.remove(userId, ids))
