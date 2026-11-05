import { detectImageContentType, UNKNOWN_IMAGE_CONTENT_TYPE } from '../../shared/utils/image-content-type'
import { MANUAL_COVER_MAX_BYTES } from '../../shared/utils/schemas'

/** HTTP transport only. Request admission, robots rules and cooldowns live in the service. */
export function makeCatalogHttpRepository(request: typeof fetch = fetch) {
  return {
    read: async (url: string, userAgent: string, signal: AbortSignal, image = false) => {
      const response = await request(url, {
        signal, redirect: 'manual',
        headers: { 'User-Agent': userAgent, 'Accept': image ? 'image/jpeg, image/png, image/webp, image/gif' : 'text/html, application/xml, text/plain' }
      })
      const { status, headers } = response
      // Do not download an error or redirect body unnecessarily.
      if (status !== 200) {
        await response.body?.cancel()
        return { status, headers, text: '' }
      }
      const reader = response.body?.getReader()
      if (!reader) return { status, headers, text: '' }
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > (image ? MANUAL_COVER_MAX_BYTES : 512 * 1024)) throw new Error('Catalog response too large')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (image) {
        const contentType = detectImageContentType(bytes.buffer)
        if (contentType !== UNKNOWN_IMAGE_CONTENT_TYPE) {
          return { status, headers, text: '', image: bytes.buffer }
        }
      }
      return { status, headers, text: new TextDecoder().decode(bytes) }
    }
  }
}
