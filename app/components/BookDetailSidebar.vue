<script setup lang="ts">
import { isBookEnrichmentInProgress } from '~~/shared/utils/book-enrichment'

const { t } = useI18n()

const props = defineProps<{
  book: BookDetails
}>()

const coverUrl = computed(() => props.book.coverPath ? `/api/blob/${props.book.coverPath}` : null)
const isCoverEnrichmentInProgress = computed(() => isBookEnrichmentInProgress(props.book.enrichmentStatus))
const isOwnedBook = computed(() => props.book.libraryState === 'owned')
const statusLabel = computed(() => {
  if (!isOwnedBook.value) return props.book.libraryState === 'wishlisted' ? t('ui.wishlist') : t('ui.previouslyOwned')
  return props.book.activeLoan ? t('ui.lentOut') : t('ui.available')
})
const describeReadingProgress = useReadingSummary()
const readingSummary = computed(() => describeReadingProgress(
  props.book.readingProgress,
  props.book.numberOfPages
))
</script>

<template>
  <aside class="lg:sticky lg:top-24 lg:self-start">
    <div class="w-full space-y-4 sm:grid sm:grid-cols-[17.5rem_minmax(0,1fr)] sm:items-start sm:gap-6 sm:space-y-0 lg:block lg:space-y-4">
      <div class="mx-auto w-full max-w-70 sm:mx-0 sm:col-start-1 lg:col-auto">
        <NuxtImg
          v-if="coverUrl"
          :src="coverUrl"
          :alt="book.title"
          width="280"
          class="block h-auto w-full shadow-md"
        />
        <div
          v-else
          class="relative isolate aspect-2/3 overflow-hidden shadow-md"
          role="img"
          :aria-label="`Generated cover for ${book.title}`"
        >
          <BookJacket
            :title="book.title"
            :author="book.author"
          />
          <div
            class="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent"
            aria-hidden="true"
          />
          <p
            v-if="isCoverEnrichmentInProgress"
            class="absolute right-4 bottom-4 left-4 flex items-center gap-2 text-xs text-white/80"
            role="status"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="size-3.5 animate-spin"
              aria-hidden="true"
            />
            {{ $t('ui.preparingBookCover') }}
          </p>
        </div>
      </div>

      <UCard
        class="sm:col-start-2 sm:row-start-1 lg:col-auto"
        :ui="{ root: 'ring-1 ring-default', body: 'p-4' }"
        aria-labelledby="summary-heading"
      >
        <h2
          id="summary-heading"
          class="text-sm font-bold uppercase tracking-wide"
        >
          {{ $t('ui.atAGlance') }}
        </h2>
        <dl class="mt-4 space-y-3 text-sm">
          <div class="flex items-start justify-between gap-4">
            <dt class="flex items-center gap-2 text-muted">
              <UIcon
                name="i-lucide-box"
                class="size-4"
              />{{ $t('ui.status') }}
            </dt>
            <dd class="text-right font-medium">
              <span :class="book.activeLoan ? 'text-amber-600 dark:text-amber-400' : isOwnedBook ? 'text-emerald-600 dark:text-emerald-400' : ''">
                {{ statusLabel }}
              </span>
            </dd>
          </div>
          <div
            v-if="isOwnedBook"
            class="flex items-start justify-between gap-4"
          >
            <dt class="flex items-center gap-2 text-muted">
              <UIcon
                name="i-lucide-map-pin"
                class="size-4"
              />{{ $t('ui.location') }}
            </dt>
            <dd class="max-w-36 text-right font-medium">
              {{ book.location?.path || $t('ui.notSet') }}
            </dd>
          </div>
          <div
            v-if="isOwnedBook"
            class="flex items-start justify-between gap-4"
          >
            <dt class="flex items-center gap-2 text-muted">
              <UIcon
                name="i-lucide-book-open"
                class="size-4"
              />{{ $t('ui.reading') }}
            </dt>
            <dd class="max-w-36 text-right font-medium">
              {{ readingSummary }}
            </dd>
          </div>
          <div
            v-if="isOwnedBook"
            class="flex items-start justify-between gap-4"
          >
            <dt class="flex items-center gap-2 text-muted">
              <UIcon
                name="i-lucide-star"
                class="size-4"
              />{{ $t('ui.rating') }}
            </dt>
            <dd class="flex min-h-5 items-center justify-end gap-0.5">
              <template v-if="book.rating">
                <UIcon
                  v-for="star in 5"
                  :key="star"
                  name="i-lucide-star"
                  :class="star <= book.rating ? 'size-4 fill-amber-400 text-amber-500' : 'size-4 text-muted'"
                />
                <span class="sr-only">{{ book.rating }} {{ $t('ui.outOf5') }}</span>
              </template>
              <span
                v-else
                class="font-medium"
              >{{ $t('ui.notRated') }}</span>
            </dd>
          </div>
        </dl>
      </UCard>
    </div>
  </aside>
</template>
