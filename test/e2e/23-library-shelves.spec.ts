import { expect, test } from '@playwright/test'
import { registerUser, storageState } from './support/auth'

test('browses cover shelves, filters with tags and remembers the grid layout @mobile', async ({ browser }, testInfo) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await registerUser(page)
    const locationResponse = await context.request.post('/api/locations', { data: { name: 'Living room' } })
    expect(locationResponse.ok()).toBe(true)
    const location = await locationResponse.json()
    const titles = ['The Hobbit', 'Dune', 'The Left Hand of Darkness', 'The Name of the Rose', 'A Wizard of Earthsea', 'The Secret History', 'Piranesi', 'The Book Thief', 'Jane Eyre', 'Foundation', 'The Odyssey', 'Rebecca', 'The Trial', 'Earthsea', 'The Road', 'Emma', 'The Stranger', 'The Plague', 'Persuasion', 'The Silmarillion']
    for (const [index, title] of titles.entries()) {
      const response = await context.request.post('/api/books/manual', { data: { title, authors: [index % 2 ? 'A. Reader' : 'Ursula Le Guin'], isbn: null, tags: [index % 2 ? 'Fiction' : 'Fantasy', 'Favourites'] } })
      expect(response.ok()).toBe(true)
      const book = await response.json()
      const moved = await context.request.put(`/api/books/${book.id}/location`, { data: { locationId: location.id } })
      expect(moved.ok()).toBe(true)
    }
    await page.goto('/library')
    await expect(page.getByRole('button', { name: 'Shelves', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const shelf = page.getByRole('region', { name: 'Living room books', exact: true })
    await expect(shelf).toBeVisible()
    const first = shelf.getByTestId('book-card').first()
    const palette = await first.getByTestId('book-jacket').getAttribute('data-jacket-palette')
    await first.getByRole('link').click()
    await expect(page).toHaveURL(/\/library\/[^/?]+$/)
    await expect(page.getByTestId('book-jacket')).toHaveCount(1)
    await expect(page.getByTestId('book-jacket')).toHaveAttribute('data-jacket-palette', palette!)
    await page.goto('/library')
    await expect(shelf).toBeVisible()
    const next = shelf.getByRole('button', { name: /next/i })
    await expect(next).toBeEnabled()
    await next.click()
    await expect(shelf.getByRole('button', { name: /prev/i })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('shelves-light.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(shelf).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('shelves-dark.png'), fullPage: true })
    const loaded = page.waitForResponse(response => /\/api\/books\?/.test(response.url()) && new URL(response.url()).searchParams.get('page') === '2')
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
    const nextPage = await (await loaded).json()
    const newBook = shelf.getByRole('link').filter({ has: page.getByRole('heading', { name: nextPage.items[0].title, exact: true }) })
    await expect.poll(async () => {
      const cover = await newBook.boundingBox()
      const viewport = await shelf.locator('[data-slot="viewport"]').boundingBox()
      return !!cover && !!viewport && cover.x >= viewport.x - 2 && cover.x + cover.width <= viewport.x + viewport.width + 2
    }).toBe(true)
    // Remount the shelf at its start before testing a tag on the first card.
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    // Clicking a tag changes the filter without navigating into a book.
    await shelf.getByRole('button', { name: 'Filter by tag: Favourites', exact: true }).first().click()
    await expect(page).toHaveURL(/tags=favourites/)
    await expect(page.getByRole('heading', { name: 'My Library', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    await expect(shelf).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('shelves-desktop.png'), fullPage: true })
  } finally {
    await context.close()
  }
})

test('shows every non-empty shelf on the first page and keeps grid pagination separate', async ({ browser }) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await registerUser(page)
    const locations: Record<string, string> = {}
    for (const name of ['Alpha shelves', 'Later shelf', 'Empty shelf']) {
      const response = await context.request.post('/api/locations', { data: { name } })
      expect(response.ok()).toBe(true)
      locations[name] = (await response.json()).id
    }
    // The small shelf and unlocated books are older than an entire global page
    // of Alpha books; they must still appear in the first shelf response.
    for (const [name, count] of [['Later shelf', 2], ['', 2], ['Alpha shelves', 14]] as const) {
      for (let i = 0; i < count; i++) {
        const response = await context.request.post('/api/books/manual', { data: { title: `${name || 'Unlocated'} ${i}`, authors: ['Shelf Author'] } })
        expect(response.ok()).toBe(true)
        const book = await response.json()
        if (name) expect((await context.request.put(`/api/books/${book.id}/location`, { data: { locationId: locations[name] } })).ok()).toBe(true)
      }
    }
    await page.goto('/library')
    await expect(page.getByRole('region', { name: 'Alpha shelves books', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Later shelf books', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'No location books', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Empty shelf', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('book-card')).toHaveCount(16)
    await expect(page.getByText('Showing 16 of 18 books', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(18)
    await expect(page.getByRole('button', { name: 'Load More', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(12)
    await expect(page.getByText('Showing 12 of 18 books', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(18)
    await expect(page.getByRole('region', { name: 'Later shelf books', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Select books', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(18)
    await expect(page.getByRole('button', { name: 'Select loaded books (18)', exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})
