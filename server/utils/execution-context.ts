import { AsyncLocalStorage } from 'node:async_hooks'

type RuntimeExecutionContext = {
  assets?: { fetch: (request: Request) => Promise<Response> }
  waitUntil?: (promise: Promise<unknown>) => void
  recordDatabaseDuration?: (milliseconds: number) => void
}

export const executionContextStorage = new AsyncLocalStorage<RuntimeExecutionContext>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getEventExecutionContext(event: unknown): RuntimeExecutionContext | undefined {
  if (!isRecord(event)) return

  const context = event.context
  if (!isRecord(context)) return

  const cloudflareContext = isRecord(context.cloudflare) ? context.cloudflare : undefined
  const env = cloudflareContext && isRecord(cloudflareContext.env) ? cloudflareContext.env : undefined
  const assets = env?.ASSETS as RuntimeExecutionContext['assets']

  const waitUntil = context.waitUntil
  if (typeof waitUntil === 'function') {
    return {
      assets,
      waitUntil: waitUntil.bind(context) as (promise: Promise<unknown>) => void
    }
  }

  const cloudflare = context.cloudflare
  if (!isRecord(cloudflare)) return

  const ctx = cloudflare.ctx
  if (!isRecord(ctx)) return assets ? { assets } : undefined

  const legacyWaitUntil = ctx.waitUntil
  if (typeof legacyWaitUntil !== 'function') return assets ? { assets } : undefined

  return {
    assets,
    waitUntil: legacyWaitUntil.bind(ctx) as (promise: Promise<unknown>) => void
  }
}

export function runWithExecutionContext<T>(ctx: RuntimeExecutionContext | undefined, fn: () => T): T {
  if (!ctx) return fn()

  return executionContextStorage.run(ctx, fn)
}

export function getWaitUntil() {
  const store = executionContextStorage.getStore()
  const waitUntil = store?.waitUntil

  return typeof waitUntil === 'function'
    ? waitUntil.bind(store)
    : undefined
}

export async function measureDatabase<T>(query: () => PromiseLike<T>): Promise<T> {
  const record = executionContextStorage.getStore()?.recordDatabaseDuration
  if (!record) return await query()

  const started = performance.now()
  try {
    return await query()
  } finally {
    record(performance.now() - started)
  }
}
