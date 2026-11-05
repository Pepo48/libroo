import { Effect } from 'effect'
import { bookRefreshRequestSchema } from '../../../../shared/utils/schemas'
import { BookRefreshService } from '../../../services/book-refresh.service'

export default effectHandler((event, user) => Effect.gen(function* () {
  const input = yield* Effect.tryPromise({
    try: () => readValidatedBody(event, bookRefreshRequestSchema.parse),
    catch: error => createError({ statusCode: 400, message: 'Enter a valid ISBN and source', data: error })
  })
  const service = yield* BookRefreshService
  return yield* service.preview(user.id, getRouterParam(event, 'id')!, input)
}))
