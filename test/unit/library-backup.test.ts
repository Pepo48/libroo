import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibraryBackup, openLibraryBackup } from '../../app/utils/library-backup'
import { formatLibraryCsv, parseLibraryCsv } from '../../shared/utils/library-transfer-csv'

describe('Libroo ZIP backups', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('packages saved covers under portable paths and reports missing entries before import', async () => {
    const [first, second] = parseLibraryCsv(formatLibraryCsv([]) + '\nFirst\nSecond')
    const csv = formatLibraryCsv([
      { ...first!, cover_file: 'covers/1.webp' },
      { ...second!, cover_file: 'covers/2.webp' }
    ], true)
    const fetchCover = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchCover)
    const backup = await createLibraryBackup({
      csv,
      covers: [
        { file: 'covers/1.webp', url: '/api/blob/covers/manual/private/cover.webp' },
        { file: 'covers/2.webp', url: '/api/blob/covers/9788022210072.webp' }
      ]
    })
    expect(backup.missing).toBe(1)
    const reader = new ZipReader(new BlobReader(backup.blob), { useWebWorkers: false })
    const entries = await reader.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual(['manifest.json', 'library.csv', 'covers/1.webp'])
    const csvEntry = entries[1]!
    if (csvEntry.directory) throw new Error('Expected a CSV file')
    expect(await csvEntry.getData(new TextWriter())).toBe(csv)
    await reader.close()
    const imported = await openLibraryBackup(new File([backup.blob], 'backup.zip'))
    expect(imported.files).toEqual(['covers/1.webp', 'covers/2.webp'])
    expect(imported.missing).toBe(1)
    expect(imported.available('covers/1.webp')).toBe(true)
    expect(imported.available('../manifest.json')).toBe(false)
    await imported.close()
  })
})
