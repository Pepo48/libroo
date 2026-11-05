import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { LibraryCleanupService, LibraryCleanupServiceLive } from '../../../../server/services/library-cleanup.service'
import { LibraryCleanupRepository } from '../../../../server/repositories/library-cleanup.repository'

describe('library removal', () => {
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
