import { Effect } from 'effect'

export default effectHandler((event, user) => Effect.gen(function* () {
  const body = yield* Effect.tryPromise({
    try: () => readValidatedBody(event, bookBatchDeleteSchema.parse),
    catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
  })
  return yield* batchRemoveFromLibrary(body.ids, user.id)
}))
