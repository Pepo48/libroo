import { expect, test } from '@playwright/test'
import { registerUser, storageState } from './support/auth'
import { addManualBook } from './support/books'
import { formatLibraryCsv, libraryCsvColumns, type LibraryCsvRow } from '../../shared/utils/library-transfer-csv'

test('selects books for deletion and removes them without a page refresh @mobile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Bulk cleanup ${Date.now()}`
  try {
    await addManualBook(page, title)
    await page.goto('/library')
    await page.getByRole('button', { name: 'Select books', exact: true }).click()
    const checkbox = page.getByRole('checkbox', { name: `Select ${title}`, exact: true })
    const coverCard = page.getByTestId('book-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    const cardBounds = (await coverCard.boundingBox())!
    const checkboxBounds = (await checkbox.boundingBox())!
    expect(checkboxBounds.y - cardBounds.y).toBeGreaterThanOrEqual(0)
    expect(checkboxBounds.y - cardBounds.y).toBeLessThan(24)
    expect(cardBounds.x + cardBounds.width - checkboxBounds.x).toBeLessThan(48)
    await checkbox.check()
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete selected books?' })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete 1 record', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('reviews duplicate metadata and deletes only the explicitly selected extra record @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Duplicate cleanup ${Date.now()}`
  try {
    await addManualBook(page, title)
    await addManualBook(page, title)
    await page.goto('/library/duplicates')
    const group = page.locator('[data-testid="duplicate-group"]').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    await expect(group).toBeVisible()
    const select = group.getByRole('checkbox', { name: 'Clean up this group' })
    await expect(select).toBeDisabled()
    await group.getByRole('button', { name: 'Keep this record', exact: true }).first().click()
    await select.check()
    await expect(page.getByRole('button', { name: 'Delete 1 duplicate', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('duplicate-review.png'), fullPage: true })
    await page.getByRole('button', { name: 'Delete 1 duplicate', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete selected books?' })
    await dialog.getByRole('button', { name: 'Delete 1 record', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(group).toHaveCount(0)
    await page.goto('/library')
    await page.getByRole('textbox', { name: 'Search library' }).fill(title)
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('reports a partial bulk deletion and leaves failed records selected', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Partial cleanup ${Date.now()}`
  try {
    await addManualBook(page, title)
    const firstId = new URL(page.url()).pathname.split('/').at(-1)!
    await addManualBook(page, `${title} retained`)
    const secondId = new URL(page.url()).pathname.split('/').at(-1)!
    await page.goto('/library')
    await page.getByRole('button', { name: 'Select books', exact: true }).click()
    await page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check()
    await page.getByRole('checkbox', { name: `Select ${title} retained`, exact: true }).check()
    await page.route('**/api/books/batch-delete', async (route) => {
      // Let the real endpoint remove one record; simulate an individually rejected second record.
      const response = await route.fetch({ postData: JSON.stringify({ ids: [firstId] }) })
      const result = await response.json()
      await route.fulfill({ json: { ...result, failedIds: [secondId] } })
    })
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete selected books?' })
    await dialog.getByRole('button', { name: 'Delete 2 records', exact: true }).click()
    await expect(dialog.getByText('Review remaining records', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete 1 record', exact: true })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('partial-deletion.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: `Select ${title} retained`, exact: true })).toBeChecked()
  } finally {
    await context.close()
  }
})

test('recovers shifted pages after an interrupted 202-book deletion, then clears all library states', async ({ browser }) => {
  test.setTimeout(120_000)
  await storageState(browser, 'admin')
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await registerUser(page)
    const rows = Array.from({ length: 204 }, (_, index) => ({
      ...Object.fromEntries(libraryCsvColumns.map(column => [column, ''])),
      title: `Cleanup record ${index}`, authors: '["Cleanup Author"]',
      library_state: index === 202 ? 'wishlisted' : index === 203 ? 'previously_owned' : 'owned'
    } as LibraryCsvRow))
    for (let offset = 0; offset < rows.length; offset += 3) {
      const response = await context.request.post('/api/library/import', { data: { csv: formatLibraryCsv(rows.slice(offset, offset + 3)), conflictStrategy: 'csv' } })
      expect(response.ok()).toBe(true)
    }
    await context.addCookies([{ name: 'libroo-library-layout', value: 'grid', url: page.url() }])
    await page.goto('/library?pageSize=100')
    await page.getByTestId('grid-end').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('book-card')).toHaveCount(200)
    await page.getByTestId('grid-end').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('book-card')).toHaveCount(202)
    await page.getByRole('button', { name: 'Select books', exact: true }).click()
    await page.getByRole('button', { name: 'Select loaded books (202)', exact: true }).click()
    let requests = 0
    await page.route('**/api/books/batch-delete', async (route) => {
      requests++
      if (requests !== 1) return route.continue()
      // The write succeeds but its response is lost: retries must be idempotent.
      await route.fetch()
      await route.fulfill({ status: 503, json: { message: 'Temporary test interruption' } })
    })
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete selected books?' })
    await dialog.getByRole('button', { name: 'Delete 202 records', exact: true }).click()
    await expect(dialog).toContainText('HTTP 503')
    await expect(dialog.getByRole('button', { name: 'Retry remaining records' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(100)
    await page.getByTestId('grid-end').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('book-card')).toHaveCount(102)
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete 202 records', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('book-card')).toHaveCount(0)
    await page.goto('/settings#library-data')
    await page.getByRole('button', { name: 'Clear library', exact: true }).click()
    const clear = page.getByRole('dialog', { name: 'Clear your library?' })
    await expect(clear).toContainText('2 records in your library')
    await expect(clear.getByRole('button', { name: 'Clear library', exact: true })).toBeDisabled()
    await clear.getByLabel('Type DELETE LIBRARY to confirm').fill('DELETE LIBRARY')
    await clear.getByRole('button', { name: 'Clear library', exact: true }).click()
    await expect(clear).not.toBeVisible()
    const preview = await (await context.request.get('/api/library/removal-preview')).json()
    expect(preview).toEqual({ ids: [], total: 0, protectedLoanCount: 0 })
  } finally {
    await context.close()
  }
})

test('distinguishes an empty owned view from wishlist duplicates and clears every state', async ({ browser }) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const title = `Wishlist duplicate ${Date.now()}`
  try {
    await registerUser(page)
    for (let i = 0; i < 3; i++) {
      const response = await context.request.post('/api/books/manual', {
        data: { title, authors: ['Wishlist Author'], libraryState: 'wishlisted' }
      })
      expect(response.ok()).toBe(true)
    }
    await page.goto('/library?libraryState=owned')
    await expect(page.getByRole('heading', { name: 'No books in this view', exact: true })).toBeVisible()
    await expect(page.getByText('Your library is empty', { exact: true })).toHaveCount(0)
    await expect(page.getByText('This view shows owned books.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Show all books', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(3)

    await page.goto('/library/duplicates')
    await expect(page.getByTestId('duplicate-group')).toHaveCount(1)
    await expect(page.getByText('Wishlist Author · 3 records', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Show all books', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(3)

    await page.goto('/settings#library-data')
    await page.getByRole('button', { name: 'Clear library', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Clear your library?' })
    await expect(dialog).toContainText('3 records in your library')
    await dialog.getByLabel('Type DELETE LIBRARY to confirm').fill('DELETE LIBRARY')
    await dialog.getByRole('button', { name: 'Clear library', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    // Notifications must support native text selection and the copy shortcut.
    const notification = page.locator('[data-slot="title"]').filter({ hasText: /^3 books deleted$/ })
    await expect(notification).toBeVisible()
    await expect(notification).toHaveCSS('user-select', 'text')
    await notification.click({ clickCount: 3 })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('3 books deleted')
    await page.getByRole('button', { name: 'Copy notification', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Notification copied', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('3 books deleted')
    await expect(notification).toBeVisible()

    await page.goto('/library/duplicates')
    await expect(page.getByTestId('duplicate-group')).toHaveCount(0)
    await page.getByRole('link', { name: 'Show all books', exact: true }).click()
    await expect(page.getByText('Your library is empty', { exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})
