import type { LibraryState, ReadingStatus } from './book'

export interface DuplicateBook {
  id: string
  title: string
  authors: string[]
  isbn: string | null
  coverPath: string | null
  tags: string[]
  publishDate: string | null
  publishers: string | null
  numberOfPages: number | null
  description: string | null
  location: string | null
  libraryState: LibraryState
  readingStatus: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  rating: number | null
  note: string | null
  addedAt: string
  loanCount: number
}

export interface DuplicateBookGroup {
  key: string
  books: DuplicateBook[]
}

export interface LibraryRemovalPreview {
  ids: string[]
  total: number
  protectedLoanCount: number
}
