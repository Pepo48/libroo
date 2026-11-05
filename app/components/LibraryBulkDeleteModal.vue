<script setup lang="ts">
import { BOOK_BATCH_DELETE_MAX_IDS } from '~~/shared/utils/schemas'
import type { LibraryRemovalPreview } from '~~/shared/types/library-cleanup'

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
      error.value = 'Unable to load the library preview. Close this dialog and try again.'
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
    if (failed.length) error.value = `${failed.length} ${failed.length === 1 ? 'record' : 'records'} could not be deleted. Books with active loans are protected. Review the remaining books before retrying.`
    else open.value = false
  } catch (cause: unknown) {
    requestFailed.value = true
    const failure = cause as { statusCode?: number, status?: number, data?: { message?: string } }
    const status = failure.statusCode ?? failure.status
    error.value = `Deletion stopped${status ? ` (HTTP ${status})` : ''}. ${failure.data?.message || 'The request could not finish.'} Some records may already be deleted. You can safely retry the remaining selection.`
    dashboard.markNeedsSync()
  } finally {
    busy.value = false
    emit('finished')
    if (removed.length) toast.add({ title: `${removed.length} ${removed.length === 1 ? 'book deleted' : 'books deleted'}`, color: 'success' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="all ? 'Clear your library?' : 'Delete selected books?'"
    :description="all ? 'Remove owned, wishlisted and previously owned books across all locations and pages.' : `Delete ${ids.length} selected library ${ids.length === 1 ? 'record' : 'records'}?`"
    :dismissible="!busy"
    :close="!busy"
  >
    <template #body>
      <div class="space-y-4">
        <p
          v-if="previewLoading"
          role="status"
        >
          Counting all library records…
        </p>
        <template v-if="all && preview">
          <p>{{ preview.total }} records in your library. {{ ids.length }} can be removed; {{ preview.protectedLoanCount }} with active loans will be kept.</p>
          <UFormField label="Type DELETE LIBRARY to confirm">
            <UInput
              v-model="confirmation"
              placeholder="DELETE LIBRARY"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
        </template>
        <p>Notes, ratings and reading progress on these records will no longer appear in your library. {{ all ? 'Your account is kept.' : 'Unselected records and your account are kept.' }}</p>
        <p class="text-sm text-muted">
          Export a backup in Settings before cleaning up your library. Books with active loans will be skipped.
        </p>
        <p
          v-if="busy"
          role="status"
        >
          Processed {{ processed }} of {{ total }} records. Keep this page open.
        </p>
        <UAlert
          v-if="error"
          color="warning"
          title="Review remaining records"
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
        Cancel
      </UButton>
      <UButton
        color="error"
        :loading="busy"
        :disabled="previewLoading || !ids.length || (!!error && !requestFailed) || (all && confirmation !== 'DELETE LIBRARY')"
        @click="removeSelected"
      >
        {{ requestFailed ? 'Retry remaining records' : all ? 'Clear library' : `Delete ${ids.length} ${ids.length === 1 ? 'record' : 'records'}` }}
      </UButton>
    </template>
  </UModal>
</template>
