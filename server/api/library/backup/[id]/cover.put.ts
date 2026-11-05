import { Effect } from 'effect'
import { BookEditService } from '../../../../services/book-edit.service'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const id = getRouterParam(event, 'id')!
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, libraryBackupCoverSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Invalid cover', data: error })
    })
    const service = yield* BookEditService
    return yield* service.restoreCover(user.id, id, body.coverImage.data, body.conflictStrategy)
  })
)
