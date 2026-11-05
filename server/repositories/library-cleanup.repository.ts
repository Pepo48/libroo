import { Context, Effect, Layer } from 'effect'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { authors, bookAuthors, books, locations, loans, tags, userBooks, userBookTags } from 'hub:db:schema'
import { DbService } from '../services/db.service'
import { DatabaseError } from './book.repository'
import type { DuplicateBook } from '../../shared/types/library-cleanup'

import { hasActiveLibraryLoan, removeLibraryRecords } from './library-removal-batch'

export class LibraryCleanupRepository extends Context.Service<LibraryCleanupRepository, {
  list: (userId: string) => Effect.Effect<DuplicateBook[], DatabaseError>
  removalCandidates: (userId: string) => Effect.Effect<{ id: string, activeLoan: number }[], DatabaseError>
  removeChunk: (userId: string, ids: string[]) => Effect.Effect<string[], DatabaseError>
}>()('LibraryCleanupRepository') {}

export const LibraryCleanupRepositoryLive = Layer.effect(LibraryCleanupRepository, Effect.gen(function* () {
  const database = yield* DbService
  return {
    removalCandidates: (userId: string) => Effect.tryPromise({
      try: () => database.db.select({
        id: userBooks.id,
        activeLoan: hasActiveLibraryLoan
      }).from(userBooks).where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt))),
      catch: error => new DatabaseError({ message: `Unable to preview library removal: ${error}`, operation: 'libraryCleanup.removalCandidates' })
    }),
    removeChunk: (userId: string, ids: string[]) => Effect.tryPromise({
      try: () => removeLibraryRecords(database, userId, ids),
      catch: error => new DatabaseError({ message: `Unable to remove library records: ${error}`, operation: 'libraryCleanup.removeChunk' })
    }),
    list: (userId: string) => Effect.tryPromise({
      try: async () => {
        const rows = await database.db.select({
          id: userBooks.id,
          title: books.title,
          authorsJson: sql<string>`(select json_group_array(${authors.name}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${books.id})`,
          isbn: books.isbn,
          coverPath: books.coverPath,
          description: books.description,
          publishDate: books.publishDate,
          publishers: books.publishers,
          numberOfPages: books.numberOfPages,
          tagsJson: sql<string>`(select json_group_array(${tags.name}) from ${userBookTags} inner join ${tags} on ${tags.id} = ${userBookTags.tagId} where ${userBookTags.userBookId} = ${userBooks.id})`,
          location: locations.path,
          libraryState: userBooks.libraryState,
          readingStatus: userBooks.readingStatus,
          currentPage: userBooks.currentPage,
          progressPercent: userBooks.progressPercent,
          rating: userBooks.rating,
          note: userBooks.note,
          addedAt: userBooks.addedAt,
          loanCount: sql<number>`(select count(*) from ${loans} where ${loans.userBookId} = ${userBooks.id})`
        }).from(userBooks)
          .innerJoin(books, eq(userBooks.bookId, books.id))
          .leftJoin(locations, eq(userBooks.locationId, locations.id))
          .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
        return rows.map(({ authorsJson, tagsJson, addedAt, ...row }) => ({
          ...row, authors: JSON.parse(authorsJson) as string[], tags: JSON.parse(tagsJson) as string[], addedAt: addedAt.toISOString()
        }))
      },
      catch: error => new DatabaseError({ message: `Unable to review duplicates: ${error}`, operation: 'libraryCleanup.list' })
    })
  }
}))
