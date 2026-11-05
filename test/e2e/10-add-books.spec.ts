import { expect, test } from '@playwright/test'
import { addManualBook, bulkFixtureIsbns, fixtureIsbn, fixtureIsbnTitle, libraryBookLink, optimisticBulkIsbns, pasteBulkIsbns } from './support/books'
import { registerUser, storageState } from './support/auth'
import { addBookTabs } from './support/selectors'

const libraryRefreshPaths = new Set(['/api/books', '/api/preferences', '/api/tags', '/api/locations'])
const libraryBooksPath = '/api/books'

/** Hold the first library refresh that starts after the add response succeeds. */
async function holdPostSaveLibraryRefresh(page: import('@playwright/test').Page, addPath: string) {
  let addCompleted = false
  let releaseRefresh!: () => void
  let refreshSeen!: () => void
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const refreshStarted = new Promise<void>((resolve) => {
    refreshSeen = resolve
  })
  const heldRequests = new Set<Promise<void>>()

  const onResponse = (response: import('@playwright/test').Response) => {
    if (response.url().includes(addPath) && response.request().method() === 'POST' && response.ok()) {
      addCompleted = true
    }
  }
  page.on('response', onResponse)

  const routeHandler = async (route: import('@playwright/test').Route) => {
    const pathname = new URL(route.request().url()).pathname
    const isLibraryRefresh = libraryRefreshPaths.has(pathname)
    if (!addCompleted || route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    if (!isLibraryRefresh) {
      await route.continue()
      return
    }

    const heldRequest = (async () => {
      if (pathname === libraryBooksPath) refreshSeen()
      const response = await route.fetch()
      await refreshReleased
      await route.fulfill({ response })
    })()
    heldRequests.add(heldRequest)
    try {
      await heldRequest
    } finally {
      heldRequests.delete(heldRequest)
    }
  }
  await page.route('**/api/**', routeHandler)

  return {
    refreshStarted,
    async release() {
      releaseRefresh()
      page.off('response', onResponse)
      await Promise.all(heldRequests)
      await page.unroute('**/api/**', routeHandler)
    }
  }
}

test('submits a pending ISBN prefetch without issuing a second lookup', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  let lookupCount = 0
  let releaseLookup!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseLookup = resolve
  })
  await page.route('**/api/books/lookup', async (route) => {
    lookupCount += 1
    await responseGate
    await route.fulfill({ json: {
      found: true, isbn: '9780439362139', title: 'Prefetched Book', author: 'Test Author', coverUrl: null
    } })
  })
  try {
    await addBookTabs(page).gotoIsbn()
    await page.getByLabel('ISBN').fill('9780439362139')
    await expect.poll(() => lookupCount).toBe(1)
    const submit = page.getByRole('button', { name: 'Look Up Book' })
    await expect(submit).toBeEnabled()
    await submit.click()
    releaseLookup()
    await expect(page.getByRole('heading', { name: 'Prefetched Book' })).toBeVisible()
    expect(lookupCount).toBe(1)
  } finally {
    releaseLookup()
    await context.close()
  }
})

test('adds a book by ISBN through the OpenLibrary fixture server', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()

  const refreshGate = await holdPostSaveLibraryRefresh(page, '/api/books/bulk-add')
  try {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await page.getByRole('link', { name: 'Add Book' }).click()
    await expect(page).toHaveURL(/\/library\/add(?:\?.*)?$/)
    await expect(page.getByText('Find Book by ISBN')).toBeVisible()
    await page.getByLabel('ISBN').fill(fixtureIsbn)
    await page.getByRole('button', { name: 'Look Up Book' }).click()
    await expect(page.getByRole('heading', { name: fixtureIsbnTitle })).toBeVisible()
    await page.getByRole('button', { name: 'Add to Library' }).click()

    await refreshGate.refreshStarted
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await expect(libraryBookLink(page, fixtureIsbnTitle)).toBeVisible()
  } finally {
    await refreshGate.release()
    await context.close()
  }
})

test('adds a manual book with an uploaded private cover @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Manual Cover ${testInfo.retry}`

  await addManualBook(page, title)
  await context.close()
})

test('keeps the bulk review action visible while reviewing a long list @mobile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()

  await pasteBulkIsbns(page, bulkFixtureIsbns)
  await expect(page.getByText('12 found')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, 0))

  const actionBar = page.getByRole('navigation', { name: 'Add selected books' })
  await expect(actionBar).toBeVisible()
  await expect(actionBar.getByRole('button', { name: 'Add 12 Books to Library' })).toBeVisible()

  await actionBar.getByRole('button', { name: 'Add 12 Books to Library' }).click()
  await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
  await expect(libraryBookLink(page, 'Bulk Fixture Book 1')).toBeVisible()
  await context.close()
})

test('shows bulk added books before the post-save library refresh completes', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const refreshGate = await holdPostSaveLibraryRefresh(page, '/api/books/bulk-add')

  try {
    await pasteBulkIsbns(page, optimisticBulkIsbns)
    await expect(page.getByText('2 found')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('navigation', { name: 'Add selected books' })
      .getByRole('button', { name: 'Add 2 Books to Library' }).click()

    await refreshGate.refreshStarted
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await expect(libraryBookLink(page, 'Bulk Fixture Book 13')).toBeVisible()
    await expect(libraryBookLink(page, 'Bulk Fixture Book 14')).toBeVisible()
    const bulkBookCover = page.getByRole('img', { name: 'Cover of Bulk Fixture Book 13', exact: true })
    await expect.poll(() => bulkBookCover.evaluate(image => (image as HTMLImageElement).naturalWidth > 0), {
      timeout: 30_000
    }).toBe(true)
  } finally {
    await refreshGate.release()
    await context.close()
  }
})

test('returns to a cached empty library before preferences finish, without refetching books', async ({ browser }) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext()
  const page = await context.newPage()
  let releasePreferences!: () => void
  const preferencesGate = new Promise<void>((resolve) => {
    releasePreferences = resolve
  })
  let bookRequests = 0
  try {
    await registerUser(page)
    await expect(page.getByRole('heading', { name: /^(Your library is empty|No books in this view)$/ })).toBeVisible()
    await page.getByRole('link', { name: 'Add Book', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Look Up Book', exact: true })).toBeVisible()
    await page.route('**/api/preferences', async (route) => {
      const response = await route.fetch()
      await preferencesGate
      await route.fulfill({ response })
    })
    await page.route('**/api/books?*', async (route) => {
      bookRequests++
      await route.continue()
    })
    await page.getByRole('link', { name: 'Back to Library', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'My Library', exact: true })).toBeVisible()
    releasePreferences()
    await expect(page.getByRole('heading', { name: /^(Your library is empty|No books in this view)$/ })).toBeVisible()
    expect(bookRequests).toBe(0)
  } finally {
    releasePreferences()
    await context.close()
  }
})

test('opens the library before slow requests finish and uses the saved wishlist view', async ({ browser }) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext()
  const page = await context.newPage()
  let releasePreferences!: () => void
  let releaseBooks!: () => void
  const preferencesGate = new Promise<void>((resolve) => {
    releasePreferences = resolve
  })
  const booksGate = new Promise<void>((resolve) => {
    releaseBooks = resolve
  })
  const bookQueries: string[] = []
  const title = `Saved wishlist ${Date.now()}`
  try {
    await registerUser(page)
    expect((await context.request.put('/api/preferences', { data: { defaultLibraryStateFilter: ['wishlisted'] } })).ok()).toBe(true)
    expect((await context.request.post('/api/books/manual', { data: { title, authors: ['Wishlist Author'], libraryState: 'wishlisted' } })).ok()).toBe(true)
    // A full visit to Add starts without an in-memory library result.
    await page.goto('/library/add')
    await page.route('**/api/preferences', async (route) => {
      const response = await route.fetch()
      await preferencesGate
      await route.fulfill({ response })
    })
    await page.route('**/api/books?*', async (route) => {
      bookQueries.push(new URL(route.request().url()).searchParams.get('libraryState') ?? '')
      const response = await route.fetch()
      await booksGate
      await route.fulfill({ response })
    })
    await page.getByRole('link', { name: 'Back to Library', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'My Library', exact: true })).toBeVisible()
    expect(bookQueries).toEqual([])
    releasePreferences()
    await expect.poll(() => bookQueries).toEqual(['wishlisted'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    releaseBooks()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    expect(bookQueries).toEqual(['wishlisted'])
  } finally {
    releasePreferences()
    releaseBooks()
    await context.close()
  }
})
