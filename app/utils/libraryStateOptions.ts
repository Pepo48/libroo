export function useLibraryStateOptions() {
  const { t } = useI18n()
  const libraryStateItems = computed(() => [
    { label: t('ui.library'), value: 'owned' },
    { label: t('ui.wishlist'), value: 'wishlisted' }
  ])
  const libraryStateFilterItems = computed(() => [
    ...libraryStateItems.value,
    { label: t('ui.previouslyOwned'), value: 'previously_owned' }
  ])
  return { libraryStateItems, libraryStateFilterItems }
}
