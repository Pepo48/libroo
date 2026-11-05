import { Effect } from 'effect'
import { z } from 'zod'
import { BookSearchService } from '../../services/book-search.service'

const searchSchema = z.object({ query: z.string().trim().min(3).max(120), source: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).default('auto') })
export default effectHandler(event => Effect.gen(function* () {
  const body = yield* Effect.tryPromise({
    try: () => readValidatedBody(event, searchSchema.parse),
    catch: () => createError({ statusCode: 400, message: 'Enter a book title between 3 and 120 characters.' })
  })
  const service = yield* BookSearchService
  return yield* service.search(body.query, body.source)
}))
