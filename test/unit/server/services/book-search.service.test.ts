import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { BookSearchService, BookSearchServiceLive } from '../../../../server/services/book-search.service'
import { BookMetadataSources, BookMetadataSourceError, type BookMetadataSource } from '../../../../server/services/book-metadata-sources'
import type { BookSearchResult } from '../../../../shared/types/book-search'

const edition = { isbn: '9780441172719', title: 'Dune', author: 'Frank Herbert', publisher: '', year: '', part: '' }
function setup() {
  const search = vi.fn(() => Effect.succeed({ books: [edition], hasMore: false } as BookSearchResult))
  const sources: BookMetadataSource[] = [{ id: 'example', label: 'Example', lookup: () => Effect.succeed(null), searchByTitle: search }]
  const run = (query: string, source = 'auto') => Effect.runPromise(Effect.gen(function* () {
    return yield* (yield* BookSearchService).search(query, source)
  }).pipe(Effect.provide(BookSearchServiceLive), Effect.provide(Layer.succeed(BookMetadataSources, { sources }))))
  return { search, sources, run }
}
describe('pluggable title search', () => {
  it('rejects expensive or unsearchable queries before invoking a provider', async () => {
    const { run, search } = setup()
    for (const query of ['a b', '---', 'x'.repeat(121)]) await expect(run(query)).rejects.toMatchObject({ _tag: 'InvalidCatalogQueryError' })
    expect(search).not.toHaveBeenCalled()
    expect((await run('Dune')).books[0]?.source).toEqual({ id: 'example', label: 'Example' })
    expect(search).toHaveBeenCalledWith('Dune', 20)
  })
  it('deduplicates ISBNs across providers and preserves attribution', async () => {
    const { run, sources } = setup()
    sources.unshift({ id: 'snapshot', label: 'Snapshot', local: true, attribution: { label: 'Public catalog', url: 'https://catalog.example/data' }, lookup: () => Effect.succeed(null), searchByTitle: () => Effect.succeed({ books: [edition], hasMore: true }) })
    const result = await run('Dune')
    expect(result.books).toHaveLength(1)
    expect(result.books[0]?.source?.attribution?.label).toBe('Public catalog')
    expect(result.hasMore).toBe(true)
  })
  it('returns available results when another provider is unavailable', async () => {
    const { run, sources } = setup()
    sources.unshift({ id: 'offline', label: 'Offline', lookup: () => Effect.succeed(null), searchByTitle: () => Effect.fail(new BookMetadataSourceError({ message: 'offline' })) })
    const result = await run('Dune')
    expect(result.books).toHaveLength(1)
    expect(result.warnings).toEqual(['Offline is temporarily unavailable.'])
  })
  it('only invokes the explicitly selected source', async () => {
    const { run, sources, search } = setup()
    sources.push({ id: 'other', label: 'Other', lookup: () => Effect.succeed(null), searchByTitle: () => Effect.succeed({ books: [], hasMore: false }) })
    await run('Dune', 'other')
    expect(search).not.toHaveBeenCalled()
    await expect(run('Dune', 'unknown')).rejects.toMatchObject({ _tag: 'InvalidMetadataSourceError' })
  })
})
