<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { DEFAULT_LIBRARY_PAGE_SIZE, buildLibraryRouteQuery } from '~~/shared/utils/library-query'
import { MAX_BULK_ISBN_INPUT_BYTES } from '~~/shared/utils/schemas'

const { t } = useI18n()
const { libraryStateItems } = useLibraryStateOptions()

const toast = useToast()

const bulkIsbnText = ref('')
const bulkIsbnBytes = computed(() => new TextEncoder().encode(bulkIsbnText.value).byteLength)
const bulkIsbnCount = computed(() => bulkIsbnText.value.split(/[\n,\s]+/).filter(Boolean).length)

const scannerStore = useIsbnScannerStore()
const {
  scannedBooks,
  targetLibraryState,
  isLookingUp,
  isAddingBooks,
  counts,
  bulkLookupProgress
} = storeToRefs(scannerStore)

const {
  addMultipleIsbns,
  removeIsbn,
  retryIsbn,
  toggleSelection,
  selectAll,
  deselectAll,
  addSelectedToLibrary,
  clearAll
} = scannerStore

async function handleBulkImport() {
  if (!bulkIsbnText.value.trim()) {
    toast.add({
      title: t('copy.noIsbnsEntered'),
      description: t('copy.pleaseEnterAtLeastOneIsbn'),
      color: 'warning'
    })
    return
  }

  if (await addMultipleIsbns(bulkIsbnText.value)) {
    bulkIsbnText.value = ''
  }
}

async function handleAddSelected() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    const query = new URLSearchParams(buildLibraryRouteQuery({
      page: 1,
      pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
      libraryState: [targetLibraryState.value]
    }))
    const queryString = query.toString()
    navigateTo(queryString ? `/library?${queryString}` : '/library')
  }
}

function reset() {
  bulkIsbnText.value = ''
  clearAll()
}

onUnmounted(reset)

defineExpose({ reset })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-list"
          class="text-lg"
        />
        <span class="font-semibold">{{ $t('ui.bulkImport') }}</span>
      </div>
    </template>

    <!-- ISBN input textarea -->
    <div
      v-if="scannedBooks.length === 0"
      class="space-y-4"
    >
      <UFormField
        :label="$t('ui.enterIsbns')"
        :hint="$t('ui.onePerLineOrSeparatedByCommas')"
      >
        <UTextarea
          v-model="bulkIsbnText"
          placeholder="9780385533225&#10;9780141439518&#10;9780743273565"
          :rows="6"
          class="w-full font-mono text-sm"
          @keydown.meta.enter="handleBulkImport"
          @keydown.ctrl.enter="handleBulkImport"
        />
      </UFormField>

      <p class="text-sm text-muted">
        {{ $t('copy.isbnInputSummary', { bytes: bulkIsbnBytes.toLocaleString(), limit: MAX_BULK_ISBN_INPUT_BYTES.toLocaleString(), count: bulkIsbnCount }) }}
      </p>

      <UFormField :label="$t('ui.addAs')">
        <USelect
          v-model="targetLibraryState"
          :items="libraryStateItems"
          class="w-full"
        />
      </UFormField>

      <p class="text-sm text-muted">
        {{ $t('ui.enterMultipleIsbnsToLookThemAll') }}
      </p>

      <UButton
        icon="i-lucide-search"
        block
        size="lg"
        :loading="isLookingUp"
        :disabled="!bulkIsbnText.trim()"
        @click="handleBulkImport"
      >
        {{ $t('ui.lookUpAll') }}
      </UButton>
    </div>

    <!-- Results -->
    <div
      v-else
      class="space-y-4"
    >
      <UFormField :label="$t('ui.addSelectedAs')">
        <USelect
          v-model="targetLibraryState"
          :items="libraryStateItems"
          class="w-full"
        />
      </UFormField>

      <BulkScanReview
        :scanned-books="scannedBooks"
        :is-adding-books="isAddingBooks"
        :counts="counts"
        :lookup-progress="bulkLookupProgress"
        :target-library-state="targetLibraryState"
        @remove="removeIsbn"
        @retry="retryIsbn"
        @toggle="toggleSelection"
        @select-all="selectAll"
        @deselect-all="deselectAll"
        @add-selected="handleAddSelected"
        @clear-all="clearAll"
      />
    </div>
  </UCard>
</template>
