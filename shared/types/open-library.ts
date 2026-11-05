export interface CatalogEditionDetails {
  originalTitle?: string
  language?: string
  edition?: string
  translators?: string[]
  series?: string
  seriesPosition?: string
  format?: string
  binding?: string
}

/** Edition metadata retained for subsequent enrichment and retries. */
export interface BookMetadata {
  metadataProvider?: string
  metadataSourceUrl?: string
  /** Source cover reference consumed by the provider adapter. */
  metadataCoverUrl?: string
  editionDetails?: CatalogEditionDetails
  title: string
  authors: string[]
  isbn: string
  openLibraryKey: string
  workKey: string | null
  coverUrl: string | null
  coverId?: number
  description?: string
  subjects?: string[]
  publishDate?: string
  publishers?: string[]
  numberOfPages?: number
}

/** Compatibility name used by the Open Library adapter and existing enrichment. */
export type OpenLibraryBookData = BookMetadata
