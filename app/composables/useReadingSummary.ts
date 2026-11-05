export function useReadingSummary() {
  const { t } = useI18n()

  return (progress: ReadingProgress | null | undefined, numberOfPages: number | null | undefined) => {
    if (!progress || progress.status === 'unread') return t('ui.unread')
    if (progress.status === 'read') return t('ui.finished')

    return progress.currentPage !== null && numberOfPages
      ? t('reading.pages', { current: progress.currentPage, total: numberOfPages })
      : t('reading.complete', { percent: progress.progressPercent ?? 0 })
  }
}
