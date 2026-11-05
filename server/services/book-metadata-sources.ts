import { Context, Data, Effect, Layer } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { OpenLibraryApiError, OpenLibraryBookNotFoundError, OpenLibraryRepository } from '../repositories/openLibrary.repository'
import type { BookMetadata } from '../../shared/types/open-library'
import type { BookSearchResult } from '../../shared/types/book-search'
import type { BookMetadataSourceInfo } from '../../shared/types/book-refresh'

export class BookMetadataSourceError extends Data.TaggedError('BookMetadataSourceError')<{ message: string }> {}
export class InvalidMetadataSourceError extends Data.TaggedError('InvalidMetadataSourceError')<{ message: string }> {}

/** Providers return metadata and optional cover bytes. The application handles persistence. */
export interface BookMetadataSource extends BookMetadataSourceInfo {
  local?: boolean
  attribution?: { label: string, url: string }
  lookupCore?: (isbn: string) => Effect.Effect<BookMetadata | null, BookMetadataSourceError, HttpClient.HttpClient>
  lookupMany?: (isbns: string[]) => Effect.Effect<Map<string, BookMetadata>, BookMetadataSourceError, HttpClient.HttpClient>
  searchByTitle?: (query: string, limit: number) => Effect.Effect<BookSearchResult, BookMetadataSourceError, HttpClient.HttpClient>
  fetchCover?: (book: BookMetadata) => Effect.Effect<ArrayBuffer | null, BookMetadataSourceError, HttpClient.HttpClient>
  lookup: (isbn: string) => Effect.Effect<BookMetadata | null, BookMetadataSourceError, HttpClient.HttpClient>
}
export class BookMetadataSources extends Context.Service<BookMetadataSources, { sources: ReadonlyArray<BookMetadataSource> }>()('BookMetadataSources') {}

export const makeOpenLibraryMetadataSource = Effect.gen(function* () {
  const repository = yield* OpenLibraryRepository
  return {
    id: 'openlibrary', label: 'Open Library',
    searchByTitle: (query: string, limit: number) => repository.searchByTitle(query, limit).pipe(Effect.mapError(error => new BookMetadataSourceError({ message: error.message }))),
    lookupMany: (isbns: string[]) => repository.lookupCoreByISBNs(isbns).pipe(Effect.mapError(error => new BookMetadataSourceError({ message: error.message }))),
    lookupCore: (isbn: string) => repository.lookupCoreByISBN(isbn).pipe(
      Effect.catchTag('OpenLibraryBookNotFoundError', () => Effect.succeed(null)),
      Effect.mapError(error => new BookMetadataSourceError({ message: error.message }))
    ),
    lookup: (isbn: string) => repository.lookupByISBN(isbn).pipe(
      Effect.catchTag('OpenLibraryBookNotFoundError', () => Effect.succeed(null)),
      Effect.mapError(error => new BookMetadataSourceError({ message: error.message }))
    )
  } satisfies BookMetadataSource
})

/** Upstream default. Forks can replace this layer to register additional providers. */
export const BookMetadataSourcesLive = Layer.effect(BookMetadataSources, Effect.gen(function* () {
  return { sources: [yield* makeOpenLibraryMetadataSource] }
}))

/** Shared ISBN orchestration: no provider names or provider-specific calls. */
export function lookupCoreMetadata(sources: ReadonlyArray<BookMetadataSource>, isbn: string) {
  return Effect.gen(function* () {
    const unavailable: string[] = []
    for (const source of sources) {
      const data = yield* (source.lookupCore ?? source.lookup)(isbn).pipe(Effect.catch((error) => {
        unavailable.push(error.message)
        return Effect.succeed(null)
      }))
      if (data) return data
    }
    if (unavailable.length) return yield* Effect.fail(new OpenLibraryApiError({ message: `Additional catalogs are temporarily unavailable. Try again later. ${[...new Set(unavailable)].join(' ')}`, status: 503 }))
    return yield* Effect.fail(new OpenLibraryBookNotFoundError({ isbn, message: 'Book not found in the available catalogs' }))
  })
}

export function lookupLocalMetadata(sources: ReadonlyArray<BookMetadataSource>, isbn: string) {
  return Effect.gen(function* () {
    for (const source of sources.filter(source => source.local)) {
      const data = yield* (source.lookupCore ?? source.lookup)(isbn).pipe(Effect.catch(() => Effect.succeed(null)))
      if (data) return data
    }
    return null
  })
}

/** Bulk paths only use offline lookups and explicitly batch-capable providers. */
export function lookupBatchMetadata(sources: ReadonlyArray<BookMetadataSource>, isbns: string[]) {
  return Effect.gen(function* () {
    const entries = yield* Effect.forEach(isbns, isbn => lookupLocalMetadata(sources, isbn).pipe(
      Effect.map(data => [isbn, data] as const)
    ), { concurrency: 4 })
    const metadata = new Map(entries.filter((entry): entry is readonly [string, BookMetadata] => entry[1] !== null))
    const failedIsbns = new Set<string>()
    for (const source of sources.filter(source => source.lookupMany)) {
      const unresolved = isbns.filter(isbn => !metadata.has(isbn))
      if (!unresolved.length) break
      const result = yield* source.lookupMany!(unresolved).pipe(Effect.catch(() => {
        for (const isbn of unresolved) failedIsbns.add(isbn)
        return Effect.succeed(new Map<string, BookMetadata>())
      }))
      for (const [isbn, data] of result) {
        if (!unresolved.includes(isbn)) continue
        metadata.set(isbn, data)
        failedIsbns.delete(isbn)
      }
    }
    return { metadata, failedIsbns }
  })
}
