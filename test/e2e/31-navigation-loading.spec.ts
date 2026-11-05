import { expect, test } from '@playwright/test'
import { registerUser } from './support/auth'
import { addManualBook, libraryBookLink } from './support/books'

test('opens Loans while loading only the selected tab', async ({ page }) => {
  await registerUser(page)
  await page.goto('/library')

  const releaseLoans = Promise.withResolvers<undefined>()
  let borrowedRequests = 0
  await page.route('**/api/loans', async (route) => {
    await releaseLoans.promise
    await route.continue()
  })
  await page.route('**/api/borrowed', async (route) => {
    borrowedRequests++
    await route.continue()
  })
  const loansResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/loans')

  try {
    await page.getByRole('link', { name: 'Loans', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Loans', exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
    expect(borrowedRequests).toBe(0)
  } finally {
    releaseLoans.resolve(undefined)
  }
  await expect(page.getByText('No loans yet')).toBeVisible()
  expect((await loansResponse).headers()['server-timing']).toMatch(/auth;dur=.*data;dur=.*db;dur=.*worker;dur=/)
  expect(borrowedRequests).toBe(0)

  await page.getByRole('button', { name: 'Lent to you' }).click()
  await expect(page.getByText('No borrowed books yet')).toBeVisible()
  expect(borrowedRequests).toBe(1)
})

test('opens Settings while account information is loading', async ({ page }) => {
  await registerUser(page)
  await page.goto('/library')

  const releaseAccount = Promise.withResolvers<undefined>()
  await page.route(/\/api\/(capabilities\/(auth|email)|auth\/verification-status)$/, async (route) => {
    await releaseAccount.promise
    await route.continue()
  })

  try {
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByText('Library data', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Loading...' })).toBeVisible()
  } finally {
    releaseAccount.resolve(undefined)
  }
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
})

test('opens Locations while the location tree is loading', async ({ page }) => {
  await registerUser(page)
  await page.goto('/library')

  const releaseLocations = Promise.withResolvers<undefined>()
  await page.route('**/api/locations', async (route) => {
    await releaseLocations.promise
    await route.continue()
  })

  try {
    await page.getByRole('banner').getByRole('link', { name: 'Locations', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  } finally {
    releaseLocations.resolve(undefined)
  }
  await expect(page.getByText('No locations yet')).toBeVisible()
})

test('opens book details while the book is loading', async ({ page }) => {
  await registerUser(page)
  const title = 'Book detail navigation'
  await addManualBook(page, title)
  const bookId = new URL(page.url()).pathname.split('/').at(-1)
  await page.goto('/library')

  const releaseBook = Promise.withResolvers<undefined>()
  await page.route(`**/api/books/${bookId}`, async (route) => {
    await releaseBook.promise
    await route.continue()
  })
  const bookResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/books/${bookId}`)

  try {
    await libraryBookLink(page, title).click()
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
  } finally {
    releaseBook.resolve(undefined)
  }
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  expect((await bookResponse).headers()['server-timing']).toMatch(/auth;dur=.*data;dur=.*db;dur=.*worker;dur=/)
})
