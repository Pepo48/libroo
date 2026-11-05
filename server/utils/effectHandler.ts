import { Effect } from 'effect'
import type { EventHandler, H3Event } from 'h3'
import { type MainServices, runEffect } from './effect'
import { requireAuth, requireVerifiedAuth } from '../services/auth.service'
import { getEventExecutionContext, runWithExecutionContext } from './execution-context'

type EffectHandlerUser = { id: string, name: string, email: string, role?: string | null }
type EffectHandlerOptions = {
  auth?: 'verified' | 'session' | false
  timing?: boolean
}

/**
 * Creates a fully Effect-based event handler with automatic error conversion.
 * Authentication defaults to verified users, but can be relaxed to any signed-in
 * session or disabled for public routes with the auth option.
 *
 * Errors are handled within Effect using catch, converting them to H3 errors.
 * The H3 error is then thrown after the Effect completes for proper HTTP response handling.
 *
 * Example usage:
 * ```ts
 * export default effectHandler(
 *   (event, user) => Effect.gen(function* () {
 *     const library = yield* getLibrary(user.id)
 *     return library
 *   })
 * )
 * ```
 */
export function effectHandler<A, E>(
  handler: (
    event: H3Event,
    user: EffectHandlerUser
  ) => Effect.Effect<A, E, MainServices>,
  options?: { auth?: 'verified' } & Pick<EffectHandlerOptions, 'timing'>
): EventHandler

export function effectHandler<A, E>(
  handler: (
    event: H3Event,
    user: EffectHandlerUser
  ) => Effect.Effect<A, E, MainServices>,
  options: { auth: 'session' } & Pick<EffectHandlerOptions, 'timing'>
): EventHandler

export function effectHandler<A, E>(
  handler: (
    event: H3Event,
    user: null
  ) => Effect.Effect<A, E, MainServices>,
  options: { auth: false } & Pick<EffectHandlerOptions, 'timing'>
): EventHandler

export function effectHandler<A, E>(
  handler: (
    event: H3Event,
    // The implementation must accept both overload handler shapes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: any
  ) => Effect.Effect<A, E, MainServices>,
  options: EffectHandlerOptions = {}
): EventHandler {
  return defineEventHandler(async (event) => {
    const started = options.timing ? performance.now() : 0
    let authenticated = started
    let handlerStarted = started
    let databaseDuration = 0
    const executionContext = getEventExecutionContext(event)
    const timedContext = options.timing
      ? { ...executionContext, recordDatabaseDuration: (duration: number) => { databaseDuration += duration } }
      : executionContext
    const effect = Effect.gen(function* () {
      if (options.timing) handlerStarted = performance.now()
      const user = options.auth === false
        ? null
        : options.auth === 'session'
          ? yield* requireAuth(event)
          : yield* requireVerifiedAuth(event)
      if (options.timing) authenticated = performance.now()
      return yield* handler(event, user)
    }).pipe(
      Effect.annotateLogs({ path: event.path })
    )

    // Run the effect pipeline:
    // 1. Provide dependencies (MainLive)
    // 2. Catch all errors and convert them to H3 errors (as success values)
    // 3. Run the promise
    const result = await runWithExecutionContext(timedContext, () => runEffect(effect))
    if (options.timing) {
      const finished = performance.now()
      setHeader(event, 'Server-Timing', [
        `auth;dur=${(authenticated - handlerStarted).toFixed(1)}`,
        `data;dur=${(finished - authenticated).toFixed(1)}`,
        `db;dur=${databaseDuration.toFixed(1)}`,
        `worker;dur=${(finished - started).toFixed(1)}`
      ].join(', '))
    }
    return result
  })
}
