<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { LibraryState } from '~~/shared/types/book'
import { storeToRefs } from 'pinia'
import { isValidIsbnChecksum } from '~~/shared/utils/schemas'
import { normalizeIsbnIdentity, normalizeIsbnText } from '~~/shared/utils/isbn'

const { t } = useI18n()

const props = defineProps<{ initialIsbn?: string }>()

const toast = useToast()
const isbnLookupStore = useIsbnLookupStore()
const { isLookingUp, isAdding } = storeToRefs(isbnLookupStore)
const { lookupIsbn, cancelLookup, addIsbnsToLibrary } = isbnLookupStore

const formState = reactive({
  isbn: ''
})

const lookupResult = ref<BookLookupResult | null>(null)
const isMoving = ref(false)
let speculativeLookupTimer: ReturnType<typeof setTimeout> | undefined
let speculativeIsbn: string | undefined
let inputVersion = 0

function normalizedCompleteIsbn(value: string) {
  const normalized = normalizeIsbnText(value)
  return (normalized.length === 10 || normalized.length === 13) && isValidIsbnChecksum(normalized)
    ? normalized
    : null
}

function scheduleSpeculativeLookup(value: string) {
  inputVersion += 1
  const version = inputVersion
  if (speculativeLookupTimer) clearTimeout(speculativeLookupTimer)
  const isbn = normalizedCompleteIsbn(value)
  if (speculativeIsbn && (!isbn || normalizeIsbnIdentity(speculativeIsbn) !== normalizeIsbnIdentity(isbn))) {
    cancelLookup(speculativeIsbn)
    speculativeIsbn = undefined
  }
  if (!isbn || lookupResult.value?.found) return

  speculativeIsbn = isbn
  speculativeLookupTimer = setTimeout(() => {
    // This only warms the shared request cache. Submit owns presentation and
    // all user-facing toasts.
    if (version === inputVersion) void lookupIsbn(isbn, { cancelOnReset: true, prefetch: true })
  }, 220)
}

watch(() => formState.isbn, scheduleSpeculativeLookup)

// Lookup book by ISBN
async function lookupISBN(payload: Pick<FormSubmitEvent<BookIsbnSchema>, 'data'>) {
  inputVersion += 1
  if (speculativeLookupTimer) clearTimeout(speculativeLookupTimer)
  // Adopt the pending prefetch rather than aborting the request being reused.
  speculativeIsbn = undefined
  lookupResult.value = null

  const lookup = await lookupIsbn(payload.data.isbn)

  if (lookup.ok) {
    const result = lookup.result
    lookupResult.value = result

    if (result.found && result.existsLocally && result.existingState !== 'wishlisted') {
      toast.add({
        title: t('copy.alreadyInLibrary'),
        description: t('copy.titleAlreadyInLibrary', { title: result.title || t('copy.thisBook') }),
        color: 'info'
      })
    } else if (!result.found) {
      toast.add({
        title: t('ui.bookNotFound'),
        description: result.message || t('copy.couldNotFindThisBookInTheAvailableCatalogs'),
        color: 'warning'
      })
    }
  } else {
    toast.add({
      title: t('copy.lookupFailed'),
      description: lookup.message,
      color: 'error'
    })
  }
}

async function addBookToLibrary(libraryState: LibraryState = 'owned') {
  if (!lookupResult.value?.found || lookupResult.value.existsLocally) return

  const result = await addIsbnsToLibrary([lookupResult.value.isbn], libraryState)

  if (result.success.length === 1) {
    toast.add({
      title: libraryState === 'wishlisted' ? t('copy.bookWishlisted') : t('copy.bookAdded'),
      description: libraryState === 'wishlisted'
        ? t('copy.titleAddedToWishlist', { title: lookupResult.value.title })
        : t('copy.titleAddedToLibrary', { title: lookupResult.value.title }),
      color: 'success'
    })

    navigateTo(libraryState === 'wishlisted' ? '/library?libraryState=wishlisted' : '/library')
    return
  }

  const failure = result.failed[0]
  const alreadyOwned = failure?.error === 'BookAlreadyOwnedError'
  if (alreadyOwned && lookupResult.value) {
    lookupResult.value.existsLocally = true
  }

  toast.add({
    title: alreadyOwned ? t('copy.alreadyInLibrary') : t('copy.failedToAddBook'),
    description: alreadyOwned
      ? t('copy.titleAlreadyInLibrary', { title: lookupResult.value.title || t('copy.thisBook') })
      : t('copy.couldNotAddThisBookToYourLibraryTryAgain'),
    color: alreadyOwned ? 'info' : 'error'
  })
}

async function moveToLibrary() {
  if (!lookupResult.value?.existingState || lookupResult.value.existingState !== 'wishlisted' || isMoving.value) return

  isMoving.value = true
  try {
    const userBookId = (lookupResult.value as BookLookupResult & { existingUserBookId?: string }).existingUserBookId
    if (!userBookId) throw new Error(t('copy.wishlistBookCouldNotBeResolved'))
    await $fetch(`/api/books/${userBookId}/state`, {
      method: 'PUT',
      body: { state: 'owned' }
    })
    toast.add({
      title: t('copy.movedToLibrary'),
      description: t('copy.titleNowInLibrary', { title: lookupResult.value.title || t('copy.thisBook') }),
      color: 'success'
    })
    navigateTo(`/library/${userBookId}`)
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : t('copy.unableToMoveBook'))
    toast.add({
      title: t('copy.couldNotMoveBook'),
      description: message,
      color: 'error'
    })
  } finally {
    isMoving.value = false
  }
}

function reset() {
  inputVersion += 1
  if (speculativeLookupTimer) clearTimeout(speculativeLookupTimer)
  lookupResult.value = null
  formState.isbn = ''
  isbnLookupStore.reset()
}

onBeforeUnmount(() => {
  inputVersion += 1
  if (speculativeLookupTimer) clearTimeout(speculativeLookupTimer)
  if (speculativeIsbn) cancelLookup(speculativeIsbn)
  speculativeIsbn = undefined
})

const previewTitle = computed(() => lookupResult.value?.existsLocally ? t('copy.alreadyInLibrary193') : t('copy.bookFound'))
const previewIconClass = computed(() => lookupResult.value?.existsLocally ? 'text-lg text-info' : 'text-lg text-success')

onMounted(() => {
  if (props.initialIsbn) {
    formState.isbn = props.initialIsbn
    void lookupISBN({ data: { isbn: props.initialIsbn } })
  }
})

// Expose for parent to reset on tab change
defineExpose({ reset })
</script>

<template>
  <!-- Step 1: ISBN Lookup -->
  <UCard v-if="!lookupResult?.found">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-search"
          class="text-lg"
        />
        <span class="font-semibold">{{ $t('ui.findBookByIsbn') }}</span>
      </div>
    </template>

    <UForm
      :schema="bookIsbnSchema"
      :state="formState"
      class="space-y-4"
      @submit="lookupISBN"
    >
      <UFormField
        label="ISBN"
        name="isbn"
        required
      >
        <UInput
          v-model="formState.isbn"
          name="isbn"
          placeholder="e.g., 9780385533225"
          size="lg"
          class="w-full"
        />
      </UFormField>

      <p class="text-sm text-muted">
        {{ $t('ui.youCanFindTheIsbnOnThe') }}
      </p>

      <UButton
        type="submit"
        icon="i-lucide-search"
        block
        size="lg"
        :loading="isLookingUp"
        :disabled="!formState.isbn.trim()"
      >
        {{ $t('ui.lookUpBook') }}
      </UButton>
    </UForm>
  </UCard>

  <!-- Step 2: Book Preview & Add -->
  <UCard v-else>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-book-check"
          :class="previewIconClass"
        />
        <span class="font-semibold">{{ previewTitle }}</span>
      </div>
    </template>

    <BookPreview
      :book="lookupResult"
      :is-adding="isAdding"
      back-label="Search Again"
      back-icon="i-lucide-arrow-left"
      :add-disabled="lookupResult.existsLocally"
      :move-disabled="isMoving"
      unavailable-label="Already in Library"
      @add="addBookToLibrary('owned')"
      @wishlist="addBookToLibrary('wishlisted')"
      @move="moveToLibrary"
      @back="reset"
    />
  </UCard>
</template>
