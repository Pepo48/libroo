import { Effect } from 'effect'
import { BookRefreshService } from '../../services/book-refresh.service'

export default effectHandler(() => Effect.gen(function* () {
  const service = yield* BookRefreshService
  return yield* service.listSources()
}))
