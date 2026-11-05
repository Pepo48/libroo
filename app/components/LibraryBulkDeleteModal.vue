<script setup lang="ts">
import { BOOK_BATCH_DELETE_MAX_IDS } from '~~/shared/utils/schemas'
import type { LibraryRemovalPreview } from '~~/shared/types/library-cleanup'

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ ids?: string[], all?: boolean }>(), { ids: () => [] })
const preview = ref<LibraryRemovalPreview | null>(null)
const previewLoading = ref(false)
const confirmation = ref('')
const requestFailed = ref(false)
const acknowledged = ref<string[]>([])
const ids = computed(() => (props.all ? preview.value?.ids ?? [] : props.ids).filter(id => !acknowledged.value.includes(id)))
const emit = defineEmits<{ removed: [ids: string[]], finished: [] }>()
const busy = ref(false)
const error = ref('')
const processed = ref(0)
const total = ref(0)
const toast = useToast()
const dashboard = useLibraryDashboardStore()
watch(open, async (isOpen) => {
  error.value = ''
  processed.value = 0
  acknowledged.value = []
  requestFailed.value = false
  confirmation.value = ''
  if (isOpen && props.all) {
    preview.value = null
    previewLoading.value = true
    try {
      preview.value = await $fetch<LibraryRemovalPreview>('/api/library/removal-preview')
    } catch {
      error.value = t('copy.unableToLoadTheLibraryPreviewCloseThisDialogAnd')
    } finally {
      previewLoading.value = false
    }
  }
})

async function removeSelected() {
  if (busy.value || (props.all && confirmation.value !== 'DELETE LIBRARY')) return
  busy.value = true
  error.value = ''
  requestFailed.value = false
  processed.value = 0
  const requestedIds = [...new Set(ids.value)]
  total.value = requestedIds.length
  const removed: string[] = []
  const failed: string[] = []
  try {
    // Database batches enforce parameter bounds and keep retries idempotent.
    const batchSize = BOOK_BATCH_DELETE_MAX_IDS
    for (let offset = 0; offset < requestedIds.length; offset += batchSize) {
      const result = await $fetch<{ removedIds: string[], failedIds: string[] }>('/api/books/batch-delete', {
        method: 'POST', body: { ids: requestedIds.slice(offset, offset + batchSize) }
      })
      removed.push(...result.removedIds)
      acknowledged.value.push(...result.removedIds)
      failed.push(...result.failedIds)
      processed.value += result.removedIds.length + result.failedIds.length
      dashboard.removeBooks(result.removedIds)
      emit('removed', result.removedIds)
    }
    if (failed.length) error.value = t('copy.deleteProtected', failed.length)
    else open.value = false
  } catch (cause: unknown) {
    requestFailed.value = true
    const failure = cause as { statusCode?: number, status?: number, data?: { message?: string } }
    const status = failure.statusCode ?? failure.status
    error.value = [t('copy.deletionStopped') + (status ? ` (HTTP ${status})` : '') + '.', failure.data?.message || t('copy.theRequestCouldNotFinish'), t('copy.someRecordsMayAlreadyBeDeletedYouCanSafelyRetry')].join(' ')
    dashboard.markNeedsSync()
  } finally {
    busy.value = false
    emit('finished')
    if (removed.length) toast.add({ title: t('copy.deletedBooks', removed.length), color: 'success' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="all ? $t('copy.clearYourLibrary') : $t('copy.deleteSelectedBooks')"
    :description="all ? $t('copy.removeOwnedWishlistedAndPreviouslyOwnedBooksAcrossAllLocations') : $t('copy.deleteSelectedCount', { count: ids.length })"
    :dismissible="!busy"
    :close="!busy"
  >
    <template #body>
      <div class="space-y-4">
        <p
          v-if="previewLoading"
          role="status"
        >
          {{ $t('ui.countingAllLibraryRecords') }}
        </p>
        <template v-if="all && preview">
          <p>{{ $t('copy.clearLibraryPreview', { total: preview.total, eligible: ids.length, protectedCount: preview.protectedLoanCount }) }}</p>
          <UFormField :label="$t('copy.clearLibraryConfirmation')">
            <UInput
              v-model="confirmation"
              placeholder="DELETE LIBRARY"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
        </template>
        <p>{{ $t('ui.notesRatingsAndReadingProgressOnThese') }} {{ all ? $t('copy.yourAccountIsKept') : $t('copy.unselectedRecordsAndYourAccountAreKept') }}</p>
        <p class="text-sm text-muted">
          {{ $t('ui.exportABackupInSettingsBeforeCleaning') }}
        </p>
        <p
          v-if="busy"
          role="status"
        >
          {{ $t('copy.deleteProgress', { processed, total }) }}
        </p>
        <UAlert
          v-if="error"
          color="warning"
          :title="$t('ui.reviewRemainingRecords')"
          :description="error"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        :disabled="busy"
        @click="open = false"
      >
        {{ $t('ui.cancel') }}
      </UButton>
      <UButton
        color="error"
        :loading="busy"
        :disabled="previewLoading || !ids.length || (!!error && !requestFailed) || (all && confirmation !== 'DELETE LIBRARY')"
        @click="removeSelected"
      >
        {{ requestFailed ? $t('copy.retryRemainingRecords') : all ? $t('ui.clearLibrary') : $t('copy.deleteRecordCount', ids.length) }}
      </UButton>
    </template>
  </UModal>
</template>
