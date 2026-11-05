import { Effect, Layer } from 'effect'
import { FetchHttpClient, type HttpClient } from 'effect/http'
import { describe, expect, it, vi } from 'vitest'
import { BookRefreshService, BookRefreshServiceLive } from '../../../../server/services/book-refresh.service'
import { BookMetadataSources, BookMetadataSourcesLive, BookMetadataSourceError, type BookMetadataSource } from '../../../../server/services/book-metadata-sources'
import { BookNotFoundError, BookRepository } from '../../../../server/repositories/book.repository'
import { OpenLibraryRepository } from '../../../../server/repositories/openLibrary.repository'
import { bookRefreshRequestSchema } from '../../../../shared/utils/schemas'
import type { OpenLibraryBookData } from '../../../../shared/types/open-library'

const isbn = '9780441172719'
const data: OpenLibraryBookData = { isbn, title: 'Dune', authors: ['Frank Herbert'], description: 'Fetched description', publishers: ['Publisher'], numberOfPages: 300, openLibraryKey: '/books/OL1M', workKey: null, coverUrl: null }
function setup() {
  const books = { getUserBookWithDetails: vi.fn(() => Effect.succeed({ id: 'entry', coverPath: null as string | null })),
    findStoredCatalogCover: vi.fn(() => Effect.succeed(null as { pathname: string, blob: Blob } | null))
  }
  const lookup = vi.fn(() => Effect.succeed(data as OpenLibraryBookData | null))
  const cover = vi.fn(() => Effect.succeed(null as ArrayBuffer | null))
  const sources: BookMetadataSource[] = [{ id: 'example', label: 'Example source', lookup }]
  const withService = <A, E>(use: (service: BookRefreshService['Service']) => Effect.Effect<A, E, HttpClient.HttpClient>) => Effect.flatMap(BookRefreshService, use).pipe(
    Effect.provide(BookRefreshServiceLive),
    Effect.provide(Layer.succeed(BookMetadataSources, { sources })),
    Effect.provide(Layer.succeed(BookRepository, books as never)),
    Effect.provide(Layer.succeed(OpenLibraryRepository, { fetchCoverImage: cover } as never)),
    Effect.provide(FetchHttpClient.layer)
  )
  const run = (input = bookRefreshRequestSchema.parse({ isbn, source: 'auto', includeCover: false })) =>
    Effect.runPromise(withService(service => service.preview('owner', 'entry', input)))
  return { books, lookup, cover, sources, run }
}
describe('book metadata refresh previews', () => {
  it('uses a registered source without reading the canonical metadata or saving any changes', async () => {
    const { run, lookup, cover, books } = setup()
    const result = await run(bookRefreshRequestSchema.parse({ isbn: '0-441-17271-7', source: 'example', includeCover: false }))
    expect(books.getUserBookWithDetails).toHaveBeenCalledWith('entry', 'owner')
    expect(lookup).toHaveBeenCalledWith(isbn)
    expect(result).toMatchObject({ source: { id: 'example', label: 'Example source' }, metadata: { title: 'Dune', authors: ['Frank Herbert'], description: 'Fetched description', publisher: 'Publisher' } })
    expect(cover).not.toHaveBeenCalled()
  })
  it('filters catalog subjects into useful tags and only exposes safe catalog links', async () => {
    const { run, lookup } = setup()
    const subjects = ['Fiction', 'Space Opera', 'space opera', 'Electronic resource']
    const editionDetails = { language: 'Slovak', series: 'Seven Sisters', seriesPosition: '1', edition: '2. vyd.', translators: ['Jana Petrikovičová'] }
    lookup.mockReturnValue(Effect.succeed({ ...data, subjects, editionDetails, metadataSourceUrl: 'https://catalog.example/record/123' }))
    expect(await run()).toMatchObject({ suggestedTags: ['Space Opera'], editionDetails, metadata: { language: 'Slovak', series: 'Seven Sisters', seriesPosition: '1' }, catalogUrl: 'https://catalog.example/record/123' })
    lookup.mockReturnValue(Effect.succeed({ ...data, metadataSourceUrl: 'javascript:alert(1)' }))
    expect((await run()).catalogUrl).toBeUndefined()
  })

  it('checks ownership before contacting any source', async () => {
    const { run, lookup, cover, books } = setup()
    books.getUserBookWithDetails.mockImplementation(() => Effect.fail(new BookNotFoundError({ bookId: 'entry' })) as never)
    await expect(run()).rejects.toThrow()
    expect(lookup).not.toHaveBeenCalled()
    expect(cover).not.toHaveBeenCalled()
  })
  it('rejects an unregistered source without treating its identifier as a URL', async () => {
    const { run, lookup, cover } = setup()
    await expect(run(bookRefreshRequestSchema.parse({ isbn, source: 'unknown' }))).rejects.toMatchObject({ _tag: 'InvalidMetadataSourceError' })
    expect(lookup).not.toHaveBeenCalled()
    expect(cover).not.toHaveBeenCalled()
    expect(bookRefreshRequestSchema.safeParse({ isbn, source: 'https://internal.example' }).success).toBe(false)
  })
  it('continues automatic lookup after a miss or source failure and reports partial availability', async () => {
    const { run, sources } = setup()
    sources.unshift({ id: 'missing', label: 'Missing', lookup: () => Effect.succeed(null) }, { id: 'offline', label: 'Offline', lookup: () => Effect.fail(new BookMetadataSourceError({ message: 'Offline' })) })
    const result = await run()
    expect(result.source?.id).toBe('example')
    expect(result.warnings).toEqual(['Offline is temporarily unavailable. Try again later.'])
  })
  it('honors registry order when a local source precedes a remote one', async () => {
    const { run, sources, lookup } = setup()
    const local = vi.fn(() => Effect.succeed({ ...data, title: 'Snapshot edition' }))
    sources.unshift({ id: 'snapshot', label: 'Snapshot', local: true, lookup: local })
    expect((await run()).metadata.title).toBe('Snapshot edition')
    expect(local).toHaveBeenCalledOnce()
    expect(lookup).not.toHaveBeenCalled()
  })
  it('leaves absent and invalid source fields out instead of proposing destructive replacements', async () => {
    const { run, lookup } = setup()
    lookup.mockImplementation(() => Effect.succeed({ ...data, title: 'x'.repeat(301), authors: [], description: undefined, numberOfPages: -1 }))
    const result = await run()
    expect(result.metadata.title).toBeUndefined()
    expect(result.metadata.authors).toBeUndefined()
    expect(result.metadata.description).toBeUndefined()
    expect(result.metadata.numberOfPages).toBeUndefined()
    expect(result.warnings).toHaveLength(2)
  })
  it('can preview a bounded cover even if no metadata is found', async () => {
    const { run, lookup, cover } = setup()
    lookup.mockImplementation(() => Effect.succeed(null))
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    cover.mockImplementation(() => Effect.succeed(bytes.buffer))
    const result = await run(bookRefreshRequestSchema.parse({ isbn, includeCover: true }))
    expect(result.source).toBeNull()
    expect(result.coverImage).toMatchObject({ contentType: 'image/png', size: 8 })
    expect(cover).toHaveBeenCalledWith(isbn, 'L')
  })
  it('includes the cover from the matched record without repeating the metadata lookup', async () => {
    const { run, lookup, cover, sources } = setup()
    const matched = { ...data, metadataSourceUrl: 'https://catalog.example/record/123' }
    lookup.mockImplementation(() => Effect.succeed(matched))
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const fetchCover = vi.fn(() => Effect.succeed(bytes.buffer))
    sources[0]!.fetchCover = fetchCover

    const preview = await run(bookRefreshRequestSchema.parse({ isbn, includeCover: true }))
    expect(preview.coverSource).toEqual({ id: 'example', label: 'Example source' })
    expect(preview.coverImage).toMatchObject({ contentType: 'image/jpeg', size: 4 })
    expect(fetchCover).toHaveBeenCalledExactlyOnceWith(matched)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(cover).not.toHaveBeenCalled()
  })

  it('keeps metadata and falls back to Open Library if the automatic source cover fails', async () => {
    const { run, cover, sources } = setup()
    sources[0]!.fetchCover = () => Effect.fail(new BookMetadataSourceError({ message: 'Cooling down' }))
    cover.mockImplementation(() => Effect.succeed(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9).buffer))

    const preview = await run(bookRefreshRequestSchema.parse({ isbn, includeCover: true }))
    expect(preview.metadata.title).toBe(data.title)
    expect(preview.coverSource?.id).toBe('openlibrary')
    expect(preview.warnings).toContain('The cover from Example source is temporarily unavailable.')
    expect(cover).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('reuses a shared ISBN cover in automatic mode (already current: %s)', async (isCurrent) => {
    const { books, run, cover, sources } = setup()
    const pathname = `covers/${isbn}.jpg`
    books.getUserBookWithDetails.mockReturnValue(Effect.succeed({ id: 'entry', coverPath: isCurrent ? pathname : null }))
    books.findStoredCatalogCover.mockReturnValue(Effect.succeed({ pathname, blob: new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)]) }))
    const fetchCover = vi.fn(() => Effect.succeed(null))
    sources[0]!.fetchCover = fetchCover

    const preview = await run(bookRefreshRequestSchema.parse({ isbn, includeCover: true }))
    expect(preview.coverSource?.id).toBe(isCurrent ? undefined : 'stored-catalog')
    expect(preview.coverImage?.contentType).toBe(isCurrent ? undefined : 'image/jpeg')
    expect(fetchCover).not.toHaveBeenCalled()
    expect(cover).not.toHaveBeenCalled()
  })

  it('the upstream default registry contains only Open Library', async () => {
    const result = await Effect.runPromise(Effect.gen(function* () {
      return (yield* BookMetadataSources).sources.map(({ id }) => id)
    }).pipe(Effect.provide(BookMetadataSourcesLive), Effect.provide(Layer.succeed(OpenLibraryRepository, {} as never))))
    expect(result).toEqual(['openlibrary'])
  })
})
