import { Context, Effect, Layer } from 'effect'
import { BookRepository } from '../repositories/book.repository'
import { OpenLibraryRepository } from '../repositories/openLibrary.repository'
import { BookMetadataSources, InvalidMetadataSourceError } from './book-metadata-sources'
import { normalizeSuggestedTags } from '../../shared/utils/tag-ingestion'
import { normalizeIsbnIdentity } from '../../shared/utils/isbn'
import { bookEditSchema, MANUAL_COVER_MAX_BYTES, type BookRefreshRequest } from '../../shared/utils/schemas'
import { detectImageContentType, UNKNOWN_IMAGE_CONTENT_TYPE } from '../../shared/utils/image-content-type'
import type { BookRefreshPreview } from '../../shared/types/book-refresh'

export const makeBookRefreshService = Effect.gen(function* () {
  const books = yield* BookRepository
  const openLibrary = yield* OpenLibraryRepository
  const registry = yield* BookMetadataSources
  return {
    listSources: () => Effect.succeed(registry.sources.map(({ id, label }) => ({ id, label }))),
    preview: (userId: string, userBookId: string, input: BookRefreshRequest) => Effect.gen(function* () {
      // Authorize before any provider request. Preview never persists book metadata or images.
      const current = yield* books.getUserBookWithDetails(userBookId, userId)
      const isbn = normalizeIsbnIdentity(input.isbn)
      const result: BookRefreshPreview = { isbn, source: null, metadata: {}, coverImage: null, warnings: [] }
      const sources = input.source === 'auto' ? registry.sources : registry.sources.filter(source => source.id === input.source)
      if (sources.length === 0) return yield* Effect.fail(new InvalidMetadataSourceError({ message: 'This metadata source is not available.' }))
      // Shared ISBN covers have no provider attribution. Reuse them in automatic mode.
      const storedCover = input.includeCover && input.source === 'auto' ? yield* books.findStoredCatalogCover(isbn) : null
      const hasCurrentCover = !!storedCover && storedCover.pathname === current.coverPath
      if (storedCover && !hasCurrentCover && storedCover.blob.size <= MANUAL_COVER_MAX_BYTES) {
        const bytes = yield* Effect.tryPromise(() => storedCover.blob.arrayBuffer()).pipe(Effect.orElseSucceed(() => null))
        result.coverImage = toCoverImage(bytes)
        if (result.coverImage) result.coverSource = { id: 'stored-catalog', label: 'Library cache' }
      }
      const needsCover = input.includeCover && !hasCurrentCover && !result.coverImage
      for (const source of sources) {
        const data = yield* source.lookup(isbn).pipe(Effect.catch(() => {
          result.warnings.push(`${source.label} is temporarily unavailable. Try again later.`)
          return Effect.succeed(null)
        }))
        if (!data) continue
        result.source = { id: source.id, label: source.label }
        const catalogUrl = data.metadataSourceUrl || (source.id === 'openlibrary' && /^\/books\/OL\d+M$/.test(data.openLibraryKey)
          ? `https://openlibrary.org${data.openLibraryKey}`
          : undefined)
        if (catalogUrl && URL.canParse(catalogUrl)) {
          const url = new URL(catalogUrl)
          if (url.protocol === 'https:' && !url.username && !url.password) result.catalogUrl = url.href
        }
        if (data.editionDetails) result.editionDetails = data.editionDetails
        const suggestedTags = normalizeSuggestedTags(data.subjects).map(tag => tag.displayName)
        if (suggestedTags.length) result.suggestedTags = suggestedTags
        const proposed = {
          title: data.title, authors: data.authors,
          publisher: data.publishers?.join(', '), publishDate: data.publishDate,
          numberOfPages: data.numberOfPages, description: data.description
        }
        for (const key of Object.keys(proposed) as Array<keyof typeof proposed>) {
          const value = proposed[key]
          if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
          const parsed = bookEditSchema.shape[key].safeParse(value)
          if (parsed.success) Object.assign(result.metadata, { [key]: parsed.data })
          else result.warnings.push(`The source returned an unsupported ${key} value; it was left out.`)
        }
        if (needsCover && source.fetchCover) {
          const bytes = yield* source.fetchCover(data).pipe(Effect.catch(() => {
            result.warnings.push(`The cover from ${source.label} is temporarily unavailable.`)
            return Effect.succeed(null)
          }))
          result.coverImage = toCoverImage(bytes)
          if (result.coverImage) result.coverSource = result.source
          else if (bytes) result.warnings.push(`${source.label} returned an unsupported cover image.`)
        }
        break
      }
      if (needsCover && !result.coverImage && (input.source === 'auto' || input.source === 'openlibrary')) {
        const bytes = yield* openLibrary.fetchCoverImage(isbn, 'L')
        result.coverImage = toCoverImage(bytes)
        if (result.coverImage) result.coverSource = { id: 'openlibrary', label: 'Open Library' }
        else if (bytes) result.warnings.push('Open Library returned an unsupported cover image.')
      }
      return result
    })
  }
})
export class BookRefreshService extends Context.Service<BookRefreshService, Effect.Success<typeof makeBookRefreshService>>()('BookRefreshService') {}
export const BookRefreshServiceLive = Layer.effect(BookRefreshService, makeBookRefreshService)

function toCoverImage(bytes: ArrayBuffer | null): BookRefreshPreview['coverImage'] {
  if (!bytes || bytes.byteLength > MANUAL_COVER_MAX_BYTES) return null
  const contentType = detectImageContentType(bytes)
  if (contentType === UNKNOWN_IMAGE_CONTENT_TYPE) return null
  return { data: Buffer.from(bytes).toString('base64'), contentType, size: bytes.byteLength }
}
