export function normalizeCatalogTitle(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
export function catalogTitleGrams(value: string): string[] {
  return [...new Set(value.split(' ').filter(word => word.length >= 3).flatMap(word =>
    Array.from({ length: word.length - 2 }, (_, i) => word.slice(i, i + 3))
  ))]
}
export function catalogGramBucket(value: string): number {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 256
}
