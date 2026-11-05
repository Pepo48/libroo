export default defineI18nConfig(() => ({
  fallbackLocale: 'en',
  pluralRules: {
    sk: (count, choicesLength, defaultRule) => {
      if (choicesLength !== 3) return defaultRule?.(count, choicesLength) ?? 0
      if (count === 1) return 0
      return count >= 2 && count <= 4 ? 1 : 2
    }
  }
}))
