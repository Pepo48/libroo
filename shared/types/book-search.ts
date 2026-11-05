import type { BookMetadataSourceInfo } from './book-refresh'

export interface BookSearchEdition {
  isbn: string
  title: string
  author: string
  publisher: string
  year: string
  part: string
  source?: BookMetadataSourceInfo
}
export interface BookSearchResult {
  books: BookSearchEdition[]
  hasMore: boolean
  warnings?: string[]
}
