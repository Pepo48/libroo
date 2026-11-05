import { describe, expect, it, vi } from 'vitest'
import { executionContextStorage, getEventExecutionContext, getWaitUntil, runWithExecutionContext } from '../../../../server/utils/execution-context'

describe('execution-context bridge', () => {
  type WaitUntilOwner = {
    scheduled: Promise<unknown>[]
    waitUntil: (this: WaitUntilOwner, promise: Promise<unknown>) => void
  }

  it('propagates an optional static-assets binding without requiring a background-task context', async () => {
    const assets = { fetch: vi.fn(async (_request: Request) => new Response('{}')) }
    const context = getEventExecutionContext({ context: { cloudflare: { env: { ASSETS: assets } } } })
    expect(context?.assets).toBe(assets)
    await runWithExecutionContext(context, async () => {
      expect(executionContextStorage.getStore()?.assets).toBe(assets)
    })
  })

  it('returns undefined outside an execution context scope', () => {
    expect(getWaitUntil()).toBeUndefined()
  })

  it('returns the scoped waitUntil accessor inside an execution context scope after an async boundary', async () => {
    const waitUntil = vi.fn()

    await runWithExecutionContext({ waitUntil }, async () => {
      await Promise.resolve()
      const scopedWaitUntil = getWaitUntil()
      const promise = Promise.resolve()

      scopedWaitUntil?.(promise)

      expect(waitUntil).toHaveBeenCalledWith(promise)
    })
  })

  it('extracts Nitro Cloudflare waitUntil from the event context', () => {
    const promise = Promise.resolve()
    const context: WaitUntilOwner = {
      scheduled: [],
      waitUntil(promise) {
        this.scheduled.push(promise)
      }
    }
    const executionContext = getEventExecutionContext({
      context
    })

    executionContext?.waitUntil?.(promise)

    expect(context.scheduled).toEqual([promise])
  })

  it('extracts legacy Cloudflare waitUntil from cloudflare.ctx', () => {
    const promise = Promise.resolve()
    const ctx: WaitUntilOwner = {
      scheduled: [],
      waitUntil(promise) {
        this.scheduled.push(promise)
      }
    }
    const executionContext = getEventExecutionContext({
      context: {
        cloudflare: {
          ctx
        }
      }
    })

    executionContext?.waitUntil?.(promise)

    expect(ctx.scheduled).toEqual([promise])
  })
})
