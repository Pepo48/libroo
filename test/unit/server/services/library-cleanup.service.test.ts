import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { groupDuplicateBooks, LibraryCleanupService, LibraryCleanupServiceLive } from '../../../../server/services/library-cleanup.service'
import { LibraryCleanupRepository } from '../../../../server/repositories/library-cleanup.repository'
import type { DuplicateBook } from '../../../../shared/types/library-cleanup'

const book = (id: string, changes: Partial<DuplicateBook> = {}): DuplicateBook => ({
  id, title: 'Červený kapitán', authors: ['Dominik Dán'], isbn: null, coverPath: null,
  description: null, tags: [], publishDate: null, publishers: null, numberOfPages: null,
  location: 'Shelf', libraryState: 'owned', readingStatus: 'unread', currentPage: null,
  progressPercent: null, rating: null, note: null, addedAt: '2026-11-04T00:00:00.000Z', loanCount: 0, ...changes
})

describe('duplicate review', () => {
  it('matches Unicode case, whitespace and author order without merging fields or changing the input', () => {
    const input = [book('b', { authors: ['First', 'Second'], note: 'Keep my note' }), book('a', { title: '  ČERVENÝ   KAPITÁN ', authors: [' second ', 'first'], coverPath: 'covers/private.webp' })]
    const before = structuredClone(input)
    const groups = groupDuplicateBooks(input)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.books.map(b => b.id)).toEqual(['a', 'b'])
    expect(groups[0]!.books[1]!.note).toBe('Keep my note')
    expect(input).toEqual(before)
  })
  it('requires the complete author set, preserving different works with the same title', () => {
    expect(groupDuplicateBooks([book('a'), book('b', { authors: ['Different Author'] }), book('c', { authors: ['Dominik Dán', 'Coauthor'] })])).toEqual([])
  })
  it('does not guess matches for unknown or missing authors', () => {
    expect(groupDuplicateBooks([book('a', { authors: [] }), book('b', { authors: [] }), book('c', { authors: ['Unknown Author'] }), book('d', { authors: ['Unknown Author'] })])).toEqual([])
  })
  it('shows different editions, states, locations and loan history for manual review', () => {
    const groups = groupDuplicateBooks([book('a'), book('b', { isbn: '9788022210072', libraryState: 'wishlisted', location: null, loanCount: 2 })])
    expect(groups[0]!.books).toHaveLength(2)
    expect(groups[0]!.books[1]).toMatchObject({ libraryState: 'wishlisted', loanCount: 2 })
  })
  it('passes only the signed-in user to the repository', async () => {
    const list = vi.fn(() => Effect.succeed([book('a'), book('b')]))
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* LibraryCleanupService
      return yield* service.preview('signed-in-user')
    }).pipe(Effect.provide(LibraryCleanupServiceLive), Effect.provide(Layer.succeed(LibraryCleanupRepository, { list, removalCandidates: () => Effect.succeed([]), removeChunk: () => Effect.succeed([]) }))))
    expect(list).toHaveBeenCalledExactlyOnceWith('signed-in-user')
    expect(result).toHaveLength(1)
  })

  it('previews the entire library while excluding active loans and batches removals within D1 limits', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `record-${index}`)
    const removeChunk = vi.fn((_user: string, chunk: string[]) => Effect.succeed(chunk.filter(id => id !== 'record-3')))
    const removalCandidates = vi.fn(() => Effect.succeed([...ids.map(id => ({ id, activeLoan: 0 })), { id: 'loaned', activeLoan: 1 }]))
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* LibraryCleanupService
      return { preview: yield* service.removalPreview('owner'), removed: yield* service.remove('owner', [...ids, ids[0]!]) }
    }).pipe(Effect.provide(LibraryCleanupServiceLive), Effect.provide(Layer.succeed(LibraryCleanupRepository, {
      list: () => Effect.succeed([]), removalCandidates, removeChunk
    }))))
    expect(result.preview).toEqual({ ids, total: 101, protectedLoanCount: 1 })
    expect(removeChunk.mock.calls.map(([owner, chunk]) => [owner, chunk.length])).toEqual([['owner', 100]])
    expect(result.removed.removedIds).toHaveLength(99)
    expect(result.removed.failedIds).toEqual(['record-3'])
  })
})
