<script setup lang="ts">
import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { isBookEnrichmentInProgress } from '~~/shared/utils/book-enrichment'

const route = useRoute()
const config = useRuntimeConfig()
const userBookId = route.params.id as string

const isEditModalOpen = ref(false)
const isLocationModalOpen = ref(false)
const isLendingModalOpen = ref(false)
const isReadingModalOpen = ref(false)
const isTagModalOpen = ref(false)
const isBookNoteModalOpen = ref(false)
const isLoanNoteModalOpen = ref(false)
const isLoanRemovalDialogOpen = ref(false)
const isOwnershipDialogOpen = ref(false)
const isWishlistRemovalDialogOpen = ref(false)
const isRecordDeletionDialogOpen = ref(false)
const isMoveToWishlistDialogOpen = ref(false)
const isMoveToLibraryDialogOpen = ref(false)
const bookNoteDraft = ref('')
const loanNoteDraft = ref('')

const { data: book, error, status, refresh } = await useFetch<BookDetails>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

const enrichmentPollTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const enrichmentPollFailures = ref(0)
const isEnrichmentPollActive = ref(import.meta.client && !document.hidden)
const hasPendingEnrichment = computed(() => isBookEnrichmentInProgress(book.value?.enrichmentStatus))

function scheduleEnrichmentPoll(delayOverride?: number) {
  if (!import.meta.client || !isEnrichmentPollActive.value || enrichmentPollTimer.value || !hasPendingEnrichment.value) return

  const delay = delayOverride ?? Math.min(60_000, 5000 * 2 ** enrichmentPollFailures.value)
  enrichmentPollTimer.value = setTimeout(async () => {
    enrichmentPollTimer.value = null
    try {
      await refresh()
      if (error.value) {
        enrichmentPollFailures.value = Math.min(enrichmentPollFailures.value + 1, 4)
        console.error('Failed to refresh book enrichment status', error.value)
      } else {
        enrichmentPollFailures.value = 0
      }
    } catch (error) {
      enrichmentPollFailures.value = Math.min(enrichmentPollFailures.value + 1, 4)
      console.error('Failed to refresh book enrichment status', error)
    } finally {
      scheduleEnrichmentPoll()
    }
  }, delay)
}

function handleVisibilityChange() {
  isEnrichmentPollActive.value = !document.hidden
  if (isEnrichmentPollActive.value) {
    enrichmentPollFailures.value = 0
    scheduleEnrichmentPoll(0)
  } else if (enrichmentPollTimer.value) {
    clearTimeout(enrichmentPollTimer.value)
    enrichmentPollTimer.value = null
  }
}

watch(hasPendingEnrichment, (pending) => {
  if (pending) {
    scheduleEnrichmentPoll()
  } else {
    enrichmentPollFailures.value = 0
    if (enrichmentPollTimer.value) {
      clearTimeout(enrichmentPollTimer.value)
      enrichmentPollTimer.value = null
    }
  }
}, { immediate: true })

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  handleVisibilityChange()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (enrichmentPollTimer.value) clearTimeout(enrichmentPollTimer.value)
})

usePageTitle(computed(() => book.value?.title ?? 'Book'))

const {
  isDeleting,
  isReturningLoan,
  isSavingReadingProgress,
  isSavingBookNote,
  isSavingLoanNote,
  isUpdatingLibraryState,
  removeBook,
  updateBookLibraryState,
  saveBookNote: persistBookNote,
  saveLoanNote: persistLoanNote,
  returnActiveLoan,
  saveReadingProgress: persistReadingProgress,
  saveRating
} = useBookDetailActions(userBookId, book, refresh)

const isOwnedBook = computed(() => book.value?.libraryState === 'owned')
const showOpenLibraryLinks = computed(() =>
  booleanConfigValue(config.public.openLibraryLinksEnabled, false)
)
const readingPercent = computed(() => {
  const progress = book.value?.readingProgress
  if (!progress) return 0
  if (progress.currentPage !== null && book.value?.numberOfPages) {
    return Math.min(100, Math.round((progress.currentPage / book.value.numberOfPages) * 100))
  }
  return progress.progressPercent ?? 0
})
const describeReadingProgress = useReadingSummary()
const readingSummary = computed(() => describeReadingProgress(
  book.value?.readingProgress,
  book.value?.numberOfPages
))

const { locale } = useI18n()

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(locale.value === 'sk' ? 'sk-SK' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function moveToWishlist() {
  isMoveToWishlistDialogOpen.value = false
  void updateBookLibraryState('wishlisted')
}

function moveToLibrary() {
  isMoveToLibraryDialogOpen.value = false
  void updateBookLibraryState('owned')
}

function requestMoveToLibrary() {
  if (book.value?.libraryState === 'wishlisted') {
    isMoveToLibraryDialogOpen.value = true
    return
  }
  void updateBookLibraryState('owned')
}

function markAsPreviouslyOwned() {
  isOwnershipDialogOpen.value = false
  void updateBookLibraryState('previously_owned')
}

function deleteBookRecord() {
  isOwnershipDialogOpen.value = false
  isWishlistRemovalDialogOpen.value = false
  isRecordDeletionDialogOpen.value = false
  void removeBook().then((result) => {
    if (result === 'active-loan') isLoanRemovalDialogOpen.value = true
  })
}

function openBookNote() {
  bookNoteDraft.value = book.value?.note ?? ''
  isBookNoteModalOpen.value = true
}

function openLoanNote() {
  loanNoteDraft.value = book.value?.activeLoan?.note ?? ''
  isLoanNoteModalOpen.value = true
}

async function saveBookNote() {
  if (await persistBookNote(bookNoteDraft.value)) isBookNoteModalOpen.value = false
}

async function saveLoanNote() {
  if (await persistLoanNote(loanNoteDraft.value)) isLoanNoteModalOpen.value = false
}

async function saveReadingProgress(progress: ReadingProgress) {
  if (await persistReadingProgress(progress)) isReadingModalOpen.value = false
}

async function onLocationSaved(location: BookLocation | null) {
  if (book.value) book.value = { ...book.value, location }
  await refresh()
}

async function onLoanSaved() {
  await refresh()
}

async function onTagsSaved() {
  await refresh()
}
</script>

<template>
  <UContainer>
    <UPageBody>
      <div
        v-if="status === 'pending' && !book"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UCard
        v-else-if="!book"
        class="py-12 text-center"
      >
        <h1 class="text-xl font-semibold">
          {{ $t('ui.bookNotFound') }}
        </h1>
        <UButton
          to="/library"
          class="mt-4"
        >
          {{ $t('ui.backToLibrary') }}
        </UButton>
      </UCard>

      <template v-else>
        <div class="grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
          <BookEditModal
            v-model:open="isEditModalOpen"
            :book="book"
            @saved="updated => { book = updated; useLibraryDashboardStore().updateBookDetails(updated) }"
          />
          <BookDetailSidebar :book="book" />

          <main class="flex flex-col gap-4">
            <BookDetailHeader
              :book="book"
              :is-deleting="isDeleting"
              :is-updating-library-state="isUpdatingLibraryState"
              :format-date="formatDate"
              @edit="isEditModalOpen = true"
              @move-to-library="requestMoveToLibrary"
              @move-to-wishlist="isMoveToWishlistDialogOpen = true"
              @mark-previously-owned="isOwnershipDialogOpen = true"
              @remove-wishlist="isWishlistRemovalDialogOpen = true"
              @delete-record="isRecordDeletionDialogOpen = true"
            />

            <section aria-labelledby="personal-heading">
              <h2
                id="personal-heading"
                class="border-b border-default pb-3 text-lg font-semibold"
              >
                {{ $t('ui.personal') }}
              </h2>
              <BookDetailCard
                v-if="isOwnedBook"
                :title="$t('ui.readingProgressText')"
                :description="readingSummary"
                icon="i-lucide-book-open"
              >
                <template #action>
                  <UButton
                    color="primary"
                    variant="link"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    @click="isReadingModalOpen = true"
                  >
                    {{ $t('ui.update') }}
                  </UButton>
                </template>
                <UProgress
                  :model-value="readingPercent"
                  :max="100"
                  class="mt-3"
                />
              </BookDetailCard>

              <BookDetailCard
                v-if="isOwnedBook"
                :title="$t('ui.rating')"
                icon="i-lucide-star"
                tone="warning"
              >
                <BookRating
                  :rating="book.rating"
                  :show-title="false"
                  :show-value="false"
                  class="mt-2"
                  compact
                  @update:rating="saveRating"
                />
              </BookDetailCard>

              <BookDetailCard
                :title="$t('ui.personalNote')"
                :description="book.note ? undefined : $t('ui.addBookNote')"
                icon="i-lucide-notebook-pen"
                tone="warning"
              >
                <template #action>
                  <UButton
                    color="primary"
                    variant="link"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    @click="openBookNote"
                  >
                    {{ book.note ? $t('ui.edit') : $t('ui.add') }}
                  </UButton>
                </template>
                <p
                  v-if="book.note"
                  class="mt-2 whitespace-pre-wrap text-sm text-muted"
                >
                  {{ book.note }}
                </p>
              </BookDetailCard>
            </section>

            <section
              v-if="isOwnedBook"
              aria-labelledby="lending-heading"
            >
              <h2
                id="lending-heading"
                class="border-b border-default pb-3 text-lg font-semibold"
              >
                {{ $t('ui.lending') }}
              </h2>
              <BookDetailCard
                :title="$t('ui.loan')"
                :description="book.activeLoan ? $t('ui.lentToBorrower', { name: book.activeLoan.acceptedByName || book.activeLoan.borrowerDisplayName }) : $t('ui.thisCopyIsCurrentlyAvailableToLend')"
                icon="i-lucide-handshake"
                tone="success"
              >
                <template
                  v-if="book.activeLoan"
                  #title-suffix
                >
                  <UBadge
                    color="warning"
                    variant="subtle"
                    size="sm"
                  >
                    {{ $t('ui.lentOut') }}
                  </UBadge>
                </template>
                <template #action>
                  <div
                    v-if="book.activeLoan"
                    class="flex items-center gap-2"
                  >
                    <UButton
                      color="primary"
                      variant="link"
                      size="sm"
                      icon="i-lucide-undo-2"
                      :loading="isReturningLoan"
                      @click="returnActiveLoan"
                    >
                      {{ $t('ui.markReturned') }}
                    </UButton>
                    <UDropdownMenu :items="[{ label: $t('ui.editLoanNote'), icon: 'i-lucide-notebook-pen', onSelect: openLoanNote }]">
                      <UButton
                        color="primary"
                        variant="link"
                        size="sm"
                        icon="i-lucide-ellipsis"
                        :aria-label="$t('ui.moreLoanActions')"
                      />
                    </UDropdownMenu>
                  </div>
                  <UButton
                    v-else
                    color="primary"
                    variant="link"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    @click="isLendingModalOpen = true"
                  >
                    {{ $t('ui.lendThisBook') }}
                  </UButton>
                </template>
                <div
                  v-if="book.activeLoan"
                  class="mt-3 space-y-2 text-sm"
                >
                  <p class="text-muted">
                    {{ $t('ui.lent') }} {{ formatDate(book.activeLoan.loanedAt) }}<template v-if="book.activeLoan.dueAt">
                      {{ $t('copy.loanDue') }} {{ formatDate(book.activeLoan.dueAt) }}
                    </template>
                  </p>
                  <div
                    v-if="book.activeLoan.note"
                    class="border-l-2 border-primary/50 pl-3"
                  >
                    <p class="text-xs font-bold uppercase tracking-wide text-muted">
                      {{ $t('ui.loanNote') }}
                    </p>
                    <p class="mt-1 whitespace-pre-wrap">
                      {{ book.activeLoan.note }}
                    </p>
                  </div>
                </div>
              </BookDetailCard>
            </section>

            <section
              aria-labelledby="organization-heading"
            >
              <h2
                id="organization-heading"
                class="border-b border-default pb-3 text-lg font-semibold"
              >
                {{ $t('ui.organization') }}
              </h2>
              <BookDetailCard
                v-if="isOwnedBook"
                :title="$t('ui.location')"
                :description="$t('ui.whereThisPhysicalCopyBelongs')"
                icon="i-lucide-map-pin"
              >
                <template #action>
                  <UButton
                    color="primary"
                    variant="link"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    @click="isLocationModalOpen = true"
                  >
                    {{ book.location ? $t('ui.update') : $t('ui.setLocation') }}
                  </UButton>
                </template>
                <p class="mt-2 text-sm font-medium">
                  {{ book.location?.path || $t('ui.noLocationSet') }}
                </p>
              </BookDetailCard>

              <BookDetailCard
                :title="$t('ui.tags')"
                :description="book.userTags.length ? undefined : $t('ui.bookTagsDescription')"
                icon="i-lucide-tag"
                tone="secondary"
              >
                <template #action>
                  <UButton
                    color="primary"
                    variant="link"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    @click="isTagModalOpen = true"
                  >
                    {{ book.userTags.length ? $t('ui.edit') : $t('ui.add') }}
                  </UButton>
                </template>
                <div
                  v-if="book.userTags.length"
                  class="mt-2 flex flex-wrap gap-2"
                >
                  <UBadge
                    v-for="tag in book.userTags"
                    :key="tag.id"
                    color="neutral"
                    variant="subtle"
                  >
                    {{ tag.name }}
                  </UBadge>
                </div>
              </BookDetailCard>
            </section>

            <div
              v-if="showOpenLibraryLinks && (book.openLibraryKey || book.workKey)"
              class="flex flex-wrap gap-2 pt-1"
            >
              <UButton
                v-if="book.openLibraryKey"
                color="primary"
                variant="link"
                size="sm"
                icon="i-lucide-external-link"
                :href="`https://openlibrary.org${book.openLibraryKey}`"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ $t('ui.viewEdition') }}
              </UButton>
              <UButton
                v-if="book.workKey"
                color="primary"
                variant="link"
                size="sm"
                icon="i-lucide-library"
                :href="`https://openlibrary.org${book.workKey}`"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ $t('ui.viewWork') }}
              </UButton>
            </div>
          </main>
        </div>

        <BookLocationModal
          v-if="book && isOwnedBook"
          v-model:open="isLocationModalOpen"
          :user-book-id="userBookId"
          :current-location="book.location"
          @saved="onLocationSaved"
        />
        <BookLendingModal
          v-if="isOwnedBook"
          v-model:open="isLendingModalOpen"
          :user-book-id="userBookId"
          @saved="onLoanSaved"
        />
        <BookReadingProgressModal
          v-if="book && isOwnedBook"
          v-model:open="isReadingModalOpen"
          :progress="book.readingProgress"
          :total-pages="book.numberOfPages"
          :saving="isSavingReadingProgress"
          @save:progress="saveReadingProgress"
        />
        <TagManagerModal
          v-if="book"
          v-model:open="isTagModalOpen"
          :user-book-id="userBookId"
          :user-tags="book.userTags"
          :suggested-tags="book.suggestedTags"
          @saved="onTagsSaved"
        />

        <UModal
          v-model:open="isMoveToWishlistDialogOpen"
          :title="$t('ui.moveToWishlist')"
          :description="$t('ui.thisClearsTheBookSLocationRating')"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isMoveToWishlistDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              icon="i-lucide-bookmark"
              :loading="isUpdatingLibraryState"
              @click="moveToWishlist"
            >
              {{ $t('ui.moveToWishlistText') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-model:open="isMoveToLibraryDialogOpen"
          :title="$t('ui.moveToLibraryText')"
          :description="$t('ui.thisWillMakeTheBookAvailableFor')"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isMoveToLibraryDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              icon="i-lucide-arrow-up-right"
              :loading="isUpdatingLibraryState"
              @click="moveToLibrary"
            >
              {{ $t('ui.moveToLibrary') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-if="book"
          v-model:open="isOwnershipDialogOpen"
          :title="$t('ui.noLongerOwnThisBook')"
          :description="book.activeLoan
            ? $t('ui.activeLoanRemovalDescription')
            : $t('ui.bookRemovalDescription')"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'flex-wrap justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isOwnershipDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              v-if="book && !book.activeLoan"
              icon="i-lucide-history"
              :loading="isUpdatingLibraryState"
              @click="markAsPreviouslyOwned"
            >
              {{ $t('ui.previouslyOwned') }}
            </UButton>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              :loading="isDeleting"
              :disabled="isUpdatingLibraryState"
              @click="deleteBookRecord"
            >
              {{ $t('ui.deleteThisBook') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-model:open="isWishlistRemovalDialogOpen"
          :title="$t('ui.removeFromWishlist')"
          :description="$t('ui.thisBookWillNoLongerAppearIn')"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isWishlistRemovalDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-x"
              :loading="isDeleting"
              @click="deleteBookRecord"
            >
              {{ $t('ui.removeFromWishlistText') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-model:open="isRecordDeletionDialogOpen"
          :title="$t('ui.deleteThisBookText')"
          :description="$t('ui.thisRemovesTheBookFromYourLibrary')"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isRecordDeletionDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              :loading="isDeleting"
              @click="deleteBookRecord"
            >
              {{ $t('ui.deleteThisBook') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-model:open="isLoanRemovalDialogOpen"
          :title="$t('ui.removeALentOutBook')"
          :description="$t('ui.thisBookWillLeaveYourLibraryBut')"
          :ui="{ footer: 'justify-end gap-3' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isLoanRemovalDialogOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              :loading="isDeleting"
              @click="removeBook(true)"
            >
              {{ $t('ui.removeFromLibrary') }}
            </UButton>
          </template>
        </UModal>

        <UModal
          v-model:open="isBookNoteModalOpen"
          :title="$t('ui.personalNote')"
          :ui="{ footer: 'justify-end gap-2' }"
        >
          <template #body>
            <UTextarea
              v-model="bookNoteDraft"
              autofocus
              :rows="6"
              :placeholder="$t('ui.writeYourNoteHere')"
              class="w-full"
              @keydown.ctrl.enter.prevent="saveBookNote"
              @keydown.meta.enter.prevent="saveBookNote"
            />
          </template><template #footer>
            <UButton
              color="neutral"
              variant="outline"
              @click="isBookNoteModalOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton><UButton
              :loading="isSavingBookNote"
              @click="saveBookNote"
            >
              {{ $t('ui.saveNote') }}
            </UButton>
          </template>
        </UModal>
        <UModal
          v-model:open="isLoanNoteModalOpen"
          :title="$t('ui.loanNote')"
          :ui="{ footer: 'justify-end gap-2' }"
        >
          <template #body>
            <UTextarea
              v-model="loanNoteDraft"
              autofocus
              :rows="6"
              :placeholder="$t('ui.addAPrivateNoteAboutThisLoan')"
              class="w-full"
              @keydown.ctrl.enter.prevent="saveLoanNote"
              @keydown.meta.enter.prevent="saveLoanNote"
            />
          </template><template #footer>
            <UButton
              color="neutral"
              variant="outline"
              @click="isLoanNoteModalOpen = false"
            >
              {{ $t('ui.cancel') }}
            </UButton><UButton
              :loading="isSavingLoanNote"
              @click="saveLoanNote"
            >
              {{ $t('ui.saveNote') }}
            </UButton>
          </template>
        </UModal>
      </template>
    </UPageBody>
  </UContainer>
</template>
