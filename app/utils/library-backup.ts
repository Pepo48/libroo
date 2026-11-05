import type { LibraryBackupExport } from '~~/shared/types/library-transfer'
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { LIBRARY_CSV_MAX_BYTES, LIBRARY_CSV_MAX_DATA_ROWS, parseLibraryCsv } from '~~/shared/utils/library-transfer-csv'
import { MANUAL_COVER_MAX_BYTES } from '~~/shared/utils/schemas'

export const LIBRARY_BACKUP_MAX_BYTES = 512 * 1024 * 1024
const manifest = { format: 'libroo-library', version: 1 }
const coverFile = /^covers\/[a-z0-9][a-z0-9_.-]{0,100}\.(?:webp|jpe?g|png|gif)$/i

export async function createLibraryBackup(data: LibraryBackupExport) {
  const csv = new TextReader(data.csv)
  if (csv.size > LIBRARY_CSV_MAX_BYTES) {
    throw new Error('The library exceeds the backup format limits')
  }
  // Validate the same row and field limits used during restore.
  parseLibraryCsv(data.csv)
  const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 0, useWebWorkers: false })
  let bytes = csv.size
  let missing = 0
  await zip.add('manifest.json', new TextReader(JSON.stringify(manifest)))
  await zip.add('library.csv', csv)
  for (let offset = 0; offset < data.covers.length; offset += 4) {
    const covers = await Promise.all(data.covers.slice(offset, offset + 4).map(async ({ file, url }) => {
      const response = await fetch(url, { mode: 'same-origin', redirect: 'error' })
      if (response.status === 404) return { file, blob: null }
      if (!response.ok) throw new Error(`Cover download failed (HTTP ${response.status})`)
      const blob = await response.blob()
      return { file, blob: blob.size && blob.size <= MANUAL_COVER_MAX_BYTES ? blob : null }
    }))
    for (const { file, blob } of covers) {
      if (!blob) {
        missing++
        continue
      }
      bytes += blob.size
      if (bytes > LIBRARY_BACKUP_MAX_BYTES - 4 * 1024 * 1024) {
        throw new Error('The library backup exceeds 512 MB')
      }
      await zip.add(file, new BlobReader(blob))
    }
  }
  return { blob: await zip.close(), missing }
}

async function readEntry(entry: FileEntry, limit: number): Promise<Blob> {
  if (entry.uncompressedSize > limit) throw new Error(`Backup entry is too large: ${entry.filename}`)
  const chunks: ArrayBuffer[] = []
  let bytes = 0
  await entry.getData(new WritableStream<Uint8Array>({
    write(chunk) {
      bytes += chunk.byteLength
      if (bytes > limit) throw new Error(`Backup entry is too large: ${entry.filename}`)
      chunks.push(Uint8Array.from(chunk).buffer)
    }
  }), { checkSignature: true, useWebWorkers: false })
  return new Blob(chunks)
}

export async function openLibraryBackup(file: File) {
  if (file.size > LIBRARY_BACKUP_MAX_BYTES) throw new Error('Choose a ZIP backup under 512 MB')
  const zip = new ZipReader(new BlobReader(file), { useWebWorkers: false })
  try {
    const entries = new Map<string, FileEntry>()
    let count = 0
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > LIBRARY_CSV_MAX_DATA_ROWS + 32) throw new Error('The ZIP has too many files')
      if (entry.directory || (entry.filename !== 'library.csv' && entry.filename !== 'manifest.json' && !coverFile.test(entry.filename))) continue
      if (entries.has(entry.filename)) throw new Error(`Duplicate file in backup: ${entry.filename}`)
      entries.set(entry.filename, entry)
    }
    const manifestEntry = entries.get('manifest.json')
    const csvEntry = entries.get('library.csv')
    if (!manifestEntry || !csvEntry) throw new Error('This ZIP is missing manifest.json or library.csv')
    const version = JSON.parse(await (await readEntry(manifestEntry, 4096)).text())
    if (version?.format !== manifest.format || version.version !== manifest.version) throw new Error('Unsupported Libroo backup version')
    const csv = await (await readEntry(csvEntry, LIBRARY_CSV_MAX_BYTES)).text()
    const rows = parseLibraryCsv(csv)
    const files = rows.map(row => row.cover_file?.trim() || '')
    const available = (name: string) => coverFile.test(name) && entries.has(name)
    const withCover = files.filter(Boolean)
    const missing = withCover.filter(name => !available(name)).length
    return {
      csv,
      files,
      missing,
      coverCount: withCover.length - missing,
      available,
      readCover: async (name: string) => {
        const entry = coverFile.test(name) ? entries.get(name) : undefined
        if (!entry) throw new Error('Cover file is missing from the ZIP')
        const blob = await readEntry(entry, MANUAL_COVER_MAX_BYTES)
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1]!)
          reader.onerror = () => reject(new Error('Could not read the cover file'))
          reader.readAsDataURL(blob)
        })
        return { data, contentType: 'image/' + name.split('.').at(-1)!.toLowerCase().replace(/^jpg$/, 'jpeg'), size: blob.size }
      },
      close: () => zip.close()
    }
  } catch (error) {
    await zip.close()
    throw error
  }
}
