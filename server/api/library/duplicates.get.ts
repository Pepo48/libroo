import { Effect } from 'effect'
import { LibraryCleanupService, LibraryCleanupServiceLive } from '../../services/library-cleanup.service'
import { LibraryCleanupRepositoryLive } from '../../repositories/library-cleanup.repository'

export default effectHandler((_event, user) => Effect.gen(function* () {
  const service = yield* LibraryCleanupService
  return yield* service.preview(user.id)
}).pipe(
  Effect.provide(LibraryCleanupServiceLive),
  Effect.provide(LibraryCleanupRepositoryLive)
))
