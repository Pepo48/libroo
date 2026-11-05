/** Capture the app translator for client callbacks and stores with an English fallback. */
export function getClientTranslator() {
  const app = typeof tryUseNuxtApp === 'function' ? tryUseNuxtApp() : undefined
  return (key: string, fallback: string, values: Record<string, string | number> = {}) =>
    app?.$i18n?.t(key, values) ?? fallback
}
