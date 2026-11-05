import type { BookEditSchema } from '../utils/schemas'
import type { CatalogEditionDetails } from './open-library'

export interface BookMetadataSourceInfo {
  id: string
  label: string
  attribution?: { label: string, url: string }
}
export type BookRefreshFields = Pick<BookEditSchema, 'title' | 'authors' | 'publisher' | 'publishDate' | 'numberOfPages' | 'description' | 'language' | 'series' | 'seriesPosition'>
export interface BookRefreshPreview {
  isbn: string
  source: BookMetadataSourceInfo | null
  metadata: Partial<BookRefreshFields>
  catalogUrl?: string
  editionDetails?: CatalogEditionDetails
  suggestedTags?: string[]
  coverSource?: BookMetadataSourceInfo
  coverImage: BookEditSchema['coverImage']
  warnings: string[]
}
export type BookRefreshSelection = Partial<BookRefreshFields> & { coverImage?: NonNullable<BookEditSchema['coverImage']>, addTags?: string[] }
