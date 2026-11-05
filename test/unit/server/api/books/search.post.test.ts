import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupApiRouteTest, importRoute, itRequiresAuth, makeEvent, mockLoggedInUser, routePath, setupApiRouteTest } from '../_helpers/api-route'

const route = routePath('books/search.post')
describe('server/api/books/search.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)
  itRequiresAuth(route, { body: { query: 'Harry Potter' } })
  it('rejects short and oversized queries before invoking the catalog', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)
    for (const query of ['', 'ab', 'x'.repeat(121)]) {
      await expect(handler(makeEvent({ body: { query } }))).rejects.toMatchObject({ statusCode: 400 })
    }
  })
})
