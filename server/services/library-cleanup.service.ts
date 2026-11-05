import { Context, Effect, Layer } from 'effect'
import { LibraryCleanupRepository } from '../repositories/library-cleanup.repository'
import type { DuplicateBook, DuplicateBookGroup, LibraryRemovalPreview } from '../../shared/types/library-cleanup'

const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

// These are candidates for review, not proof that two physical copies are identical.
export function groupDuplicateBooks(books: DuplicateBook[]): DuplicateBookGroup[] {
  const groups = new Map<string, DuplicateBook[]>()
  for (const book of books) {
    const authors = [...new Set(book.authors.map(normalize).filter(Boolean))].sort()
    if (!normalize(book.title) || !authors.length || authors.every(author => author === 'unknown author')) continue
    const key = JSON.stringify([normalize(book.title), authors])
    const group = groups.get(key) ?? []
    group.push(book)
    groups.set(key, group)
  }
  return [...groups].filter(([, group]) => group.length > 1).map(([key, group]) => ({
    key, books: group.toSorted((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
  }))
}

export class LibraryCleanupService extends Context.Service<LibraryCleanupService, {
  removalPreview: (userId: string) => Effect.Effect<LibraryRemovalPreview, import('../repositories/book.repository').DatabaseError>
  remove: (userId: string, ids: string[]) => Effect.Effect<{ removedIds: string[], failedIds: string[] }, import('../repositories/book.repository').DatabaseError>
  preview: (userId: string) => Effect.Effect<DuplicateBookGroup[], import('../repositories/book.repository').DatabaseError>
}>()('LibraryCleanupService') {}

export const LibraryCleanupServiceLive = Layer.effect(LibraryCleanupService, Effect.gen(function* () {
  const repository = yield* LibraryCleanupRepository
  return {
    preview: (userId: string) => repository.list(userId).pipe(Effect.map(groupDuplicateBooks)),
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
