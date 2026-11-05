import { Context, Data, Effect, Layer } from 'effect'
import { BookMetadataSources, InvalidMetadataSourceError } from './book-metadata-sources'
import type { BookSearchResult } from '../../shared/types/book-search'
import { normalizeCatalogTitle } from '../../shared/utils/catalog-title'

export class InvalidCatalogQueryError extends Data.TaggedError('InvalidCatalogQueryError')<{ message: string }> {}
export class BookSearchService extends Context.Service<BookSearchService, Effect.Success<typeof makeBookSearchService>>()('BookSearchService') {}
export const makeBookSearchService = Effect.gen(function* () {
  const registry = yield* BookMetadataSources
  return {
    search: (query: string, source = 'auto') => Effect.gen(function* () {
      if (query.length > 120 || !normalizeCatalogTitle(query).split(' ').some(word => word.length >= 3)) {
        return yield* Effect.fail(new InvalidCatalogQueryError({ message: 'Enter at least three letters of a book title (maximum 120 characters).' }))
      }
      const sources = registry.sources.filter(item => item.searchByTitle && (source === 'auto' || source === item.id))
      if (!sources.length) return yield* Effect.fail(new InvalidMetadataSourceError({ message: 'No title-search source is available.' }))
      const result: BookSearchResult = { books: [], hasMore: false, warnings: [] }
      const seen = new Set<string>()
      for (const provider of sources.toSorted((a, b) => Number(!!b.local) - Number(!!a.local))) {
        const found = yield* provider.searchByTitle!(query, 20).pipe(Effect.catch(() => {
          result.warnings!.push(`${provider.label} is temporarily unavailable.`)
          return Effect.succeed({ books: [], hasMore: false } satisfies BookSearchResult)
        }))
        result.hasMore ||= found.hasMore
        for (const book of found.books) {
          if (seen.has(book.isbn)) continue
          seen.add(book.isbn)
          if (result.books.length === 20) {
            result.hasMore = true
            break
          }
          result.books.push({ ...book, source: { id: provider.id, label: provider.label, ...(provider.attribution ? { attribution: provider.attribution } : {}) } })
        }
        if (result.books.length === 20) {
          result.hasMore ||= sources.length > 1
          break
        }
      }
      return result
    })
  }
})
export const BookSearchServiceLive = Layer.effect(BookSearchService, makeBookSearchService)
