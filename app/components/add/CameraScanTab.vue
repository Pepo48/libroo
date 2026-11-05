<script setup lang="ts">
import type { AddLibraryState } from '~/stores/isbnScanner'
import { storeToRefs } from 'pinia'
import { defaultContinuousMode } from '~/utils/cameraScanDefaults'

const { t } = useI18n()
const { libraryStateItems } = useLibraryStateOptions()

const toast = useToast()

// Default to continuous: user testing showed the toggle was missed, and bulk intake is primary; single scan remains available.
const continuousMode = ref(defaultContinuousMode)
const showScanner = ref(false)

// Use composable for both single and continuous modes
const scannerStore = useIsbnScannerStore()
const {
  scannedBooks,
  targetLibraryState,
  isAddingBooks,
  counts,
  bulkLookupProgress
} = storeToRefs(scannerStore)

const {
  addIsbn,
  removeIsbn,
  retryIsbn,
  toggleSelection,
  selectAll,
  deselectAll,
  addSelectedToLibrary,
  clearAll
} = scannerStore

// In single mode, the first scanned book is our current lookup result
const singleScanBook = computed(() =>
  !continuousMode.value && scannedBooks.value.length === 1
    ? scannedBooks.value[0]
    : null
)

// Handle scanned ISBN
async function onIsbnDetected(isbn: string) {
  if (continuousMode.value) {
    addIsbn(isbn)
  } else {
    // Single mode: clear previous and add new
    clearAll()
    showScanner.value = false
    await addIsbn(isbn)

    // Show toast for not found
    const book = scannedBooks.value[0]
    if (book?.status === 'not_found') {
      toast.add({
        title: t('ui.bookNotFound'),
        description: book.result?.message || t('copy.couldNotFindThisBookOnOpenlibrary'),
        color: 'warning'
      })
    } else if (book?.status === 'error') {
      toast.add({
        title: t('copy.lookupFailed'),
        description: book.errorMessage || t('copy.failedToLookupBook'),
        color: 'error'
      })
    }
  }
}

async function addSingleScanBook(targetState: AddLibraryState, redirectPath: string) {
  targetLibraryState.value = targetState
  if (singleScanBook.value?.result?.found && singleScanBook.value.status !== 'already_owned') {
    singleScanBook.value.status = 'found'
    singleScanBook.value.selected = true
  }

  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    navigateTo(redirectPath)
  }
}

// Add book to library (single scan mode) - uses composable's addSelectedToLibrary
async function addBookToLibrary() {
  await addSingleScanBook('owned', '/library')
}

async function addBookToWishlist() {
  await addSingleScanBook('wishlisted', '/library?libraryState=wishlisted')
}

// Handle adding selected books in continuous mode
async function handleAddSelected() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    navigateTo(targetLibraryState.value === 'wishlisted' ? '/library?libraryState=wishlisted' : '/library')
  }
}

function resetLookup() {
  clearAll()
  showScanner.value = true
}

function reset() {
  showScanner.value = false
  clearAll()
}

onUnmounted(reset)

defineExpose({ reset })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-scan-barcode"
            class="text-lg"
          />
          <span class="font-semibold">{{ $t('ui.scanBarcode') }}</span>
        </div>

        <!-- Continuous mode toggle (hide when showing single result) -->
        <div
          v-if="!singleScanBook?.result?.found || continuousMode"
          class="flex items-center gap-2"
        >
          <USelect
            v-model="targetLibraryState"
            :items="libraryStateItems"
            size="sm"
            :aria-label="$t('ui.addScannedBooksAs')"
            class="w-32"
          />
          <span class="text-sm text-muted">{{ $t('ui.continuous') }}</span>
          <USwitch v-model="continuousMode" />
        </div>
      </div>
    </template>

    <!-- Single scan result preview -->
    <template v-if="singleScanBook?.result?.found">
      <UAlert
        v-if="singleScanBook.errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        :description="singleScanBook.errorMessage"
        class="mb-4"
      />
      <BookPreview
        :book="singleScanBook.result"
        :is-adding="isAddingBooks"
        back-label="Scan Again"
        back-icon="i-lucide-scan-barcode"
        @add="addBookToLibrary"
        @wishlist="addBookToWishlist"
        @back="resetLookup"
      />
    </template>

    <!-- Loading state for single scan -->
    <template v-else-if="singleScanBook?.status === 'loading'">
      <div class="text-center py-8">
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-3xl text-primary mb-3"
        />
        <p class="text-muted">
          {{ $t('ui.lookingUpBook') }}
        </p>
      </div>
    </template>

    <!-- Scanner start prompt -->
    <template v-else-if="!showScanner">
      <div class="text-center py-8">
        <UIcon
          name="i-lucide-camera"
          class="text-5xl text-primary mb-4"
        />
        <p class="text-muted mb-4">
          <template v-if="continuousMode">
            {{ $t('ui.scanMultipleBookBarcodesInARow') }}
          </template>
          <template v-else>
            {{ $t('ui.scanABookBarcodeToLookIt') }}
          </template>
        </p>
        <UButton
          icon="i-lucide-camera"
          size="lg"
          @click="() => { showScanner = true }"
        >
          {{ $t('ui.startCamera') }}
        </UButton>
      </div>
    </template>

    <!-- Active scanner -->
    <template v-else>
      <IsbnScanner
        :continuous="continuousMode"
        @detected="onIsbnDetected"
      />

      <div class="mt-4 flex justify-center">
        <UButton
          icon="i-lucide-camera-off"
          color="neutral"
          variant="outline"
          @click="() => { showScanner = false }"
        >
          {{ $t('ui.stopCamera') }}
        </UButton>
      </div>
    </template>

    <!-- Results list (continuous mode) -->
    <template v-if="continuousMode && scannedBooks.length > 0">
      <USeparator class="my-4" />
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
    </template>
  </UCard>
</template>
