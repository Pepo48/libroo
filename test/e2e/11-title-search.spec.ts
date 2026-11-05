import { expect, test } from '@playwright/test'
import { storageState } from './support/auth'
import { fixtureIsbn, fixtureIsbnTitle } from './support/books'

test('searches titles through a registered provider and previews a selected edition @mobile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  await page.route('**/api/books/search', route => route.fulfill({ json: {
    books: [{ isbn: fixtureIsbn, title: fixtureIsbnTitle, author: 'Fixture Author', publisher: 'Fixture Press', year: '2024', part: '', source: { id: 'openlibrary', label: 'Open Library' } }], hasMore: false
  } }))
  await page.goto('/library/add?tab=title')
  await page.getByLabel('Book title').fill('Fixture')
  await page.getByRole('button', { name: 'Search by Title', exact: true }).click()
  const edition = page.getByRole('button').filter({ hasText: `ISBN ${fixtureIsbn}` })
  await expect(edition).toBeVisible()
  await expect(edition).toContainText('Open Library')
  await edition.click()
  await expect(page.getByRole('heading', { name: fixtureIsbnTitle, exact: true })).toBeVisible()
  await context.close()
})
