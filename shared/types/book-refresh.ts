import type { BookEditSchema } from '../utils/schemas'

export interface BookMetadataSourceInfo {
  id: string
  label: string
  attribution?: { label: string, url: string }
}
export type BookRefreshFields = Pick<BookEditSchema, 'title' | 'authors' | 'publisher' | 'publishDate' | 'numberOfPages' | 'description'>
export interface BookRefreshPreview {
  isbn: string
  source: BookMetadataSourceInfo | null
  metadata: Partial<BookRefreshFields>
  coverImage: BookEditSchema['coverImage']
  warnings: string[]
}
