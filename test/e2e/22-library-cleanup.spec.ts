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
    await page.goto('/library?pageSize=100')
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(200)
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
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
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
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
