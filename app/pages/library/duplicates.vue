<script setup lang="ts">
import type { DuplicateBookGroup } from '~~/shared/types/library-cleanup'

const { t } = useI18n()

usePageTitle(() => t('ui.reviewDuplicates'))
const { data: groups, status, error, refresh } = await useFetch<DuplicateBookGroup[]>('/api/library/duplicates', { lazy: true })
const included = ref<string[]>([])
const keep = ref<Record<string, string>>({})
const deletionOpen = ref(false)
const removedIds = ref<string[]>([])
const visibleGroups = computed(() => (groups.value ?? []).map(group => ({
  ...group, books: group.books.filter(book => !removedIds.value.includes(book.id))
})).filter(group => group.books.length > 1))
const selectedIds = computed(() => visibleGroups.value.flatMap(group => included.value.includes(group.key) && keep.value[group.key]
  ? group.books.filter(book => book.id !== keep.value[group.key] && book.loanCount === 0).map(book => book.id)
  : []))

function includeGroup(key: string, enabled: boolean | 'indeterminate') {
  included.value = enabled === true ? [...included.value.filter(item => item !== key), key] : included.value.filter(item => item !== key)
}

async function reload() {
  included.value = []
  keep.value = {}
  removedIds.value = []
  await refresh()
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="$t('ui.reviewDuplicates')"
      :description="$t('ui.reviewMatchingRecordsAcrossOwnedWishlistedAnd')"
    >
      <template #links>
        <UButton
          to="/library?libraryState=owned,wishlisted,previously_owned"
          color="neutral"
          variant="outline"
          icon="i-lucide-library"
        >
          {{ $t('ui.showAllBooks') }}
        </UButton>
        <UButton
          to="/settings#library-data"
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
        >
          {{ $t('ui.exportABackup') }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="reload"
        >
          {{ $t('ui.refresh') }}
        </UButton>
        <UButton
          color="error"
          :disabled="!selectedIds.length"
          @click="deletionOpen = true"
        >
          {{ $t('ui.delete') }} {{ selectedIds.length }} {{ selectedIds.length === 1 ? 'duplicate' : 'duplicates' }}
        </UButton>
      </template>
    </UPageHeader>
    <UPageBody>
      <UAlert
        color="info"
        :title="$t('ui.reviewBeforeDeleting')"
        :description="$t('ui.matchingTitlesAndAuthorsMayRepresentDifferent')"
      />
      <UAlert
        v-if="error"
        color="error"
        :title="$t('ui.unableToLoadDuplicates')"
        :description="$t('ui.pleaseTryRefreshingThisPage')"
      />
      <p
        v-else-if="status === 'idle' || status === 'pending'"
        role="status"
      >
        {{ $t('ui.checkingYourLibrary') }}
      </p>
      <UEmpty
        v-else-if="!visibleGroups.length"
        :title="$t('ui.noDuplicateCandidates')"
        :description="$t('ui.noRepeatedTitleAndAuthorCombinationsWere')"
        icon="i-lucide-check"
      />
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ $t('copy.duplicateGroupSummary', { count: visibleGroups.length }) }}
      </p>
      <UCard
        v-for="group in visibleGroups"
        :key="group.key"
        data-testid="duplicate-group"
      >
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold text-highlighted">
                {{ group.books[0]!.title }}
              </h2>
              <p class="text-sm text-muted">
                {{ group.books[0]!.authors.join(', ') }} · {{ $t('copy.recordCount', { count: group.books.length }) }}
              </p>
            </div>
            <UCheckbox
              :model-value="included.includes(group.key)"
              :disabled="!keep[group.key]"
              :label="$t('ui.cleanUpThisGroup')"
              @update:model-value="includeGroup(group.key, $event)"
            />
          </div>
        </template>
        <div class="grid gap-4 md:grid-cols-2">
          <UCard
            v-for="book in group.books"
            :key="book.id"
            variant="subtle"
            :class="keep[group.key] === book.id ? 'ring-2 ring-primary' : ''"
          >
            <div class="space-y-3">
              <div class="flex items-start gap-3">
                <NuxtImg
                  v-if="book.coverPath"
                  :src="`/api/blob/${book.coverPath}`"
                  :alt="$t('library.coverOf', { title: book.title })"
                  width="64"
                  height="96"
                  class="h-24 w-16 object-contain"
                  loading="lazy"
                />
                <div class="min-w-0 space-y-2">
                  <NuxtLink
                    :to="`/library/${book.id}`"
                    target="_blank"
                    class="font-medium text-primary underline"
                  >{{ $t('ui.viewBookDetails') }}</NuxtLink>
                  <p class="text-sm">
                    {{ $t(book.libraryState === 'owned' ? 'ui.owned' : book.libraryState === 'wishlisted' ? 'ui.wishlist' : 'ui.previouslyOwned') }} · {{ book.location || $t('ui.noLocation') }}
                  </p>
                  <UButton
                    :variant="keep[group.key] === book.id ? 'solid' : 'outline'"
                    :aria-pressed="keep[group.key] === book.id"
                    @click="keep[group.key] = book.id"
                  >
                    {{ keep[group.key] === book.id ? $t('copy.keepingThisRecord') : $t('copy.keepThisRecord') }}
                  </UButton>
                </div>
              </div>
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-muted">
                  ISBN
                </dt><dd>{{ book.isbn || $t('copy.none') }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.tags') }}
                </dt><dd>{{ book.tags.join(', ') || $t('copy.none') }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.edition') }}
                </dt><dd>{{ [book.publishDate, book.publishers, book.numberOfPages ? $t('copy.pageCount', { count: book.numberOfPages }) : null].filter(Boolean).join(' · ') || $t('copy.none') }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.reading') }}
                </dt><dd>{{ $t('copy.duplicateReading', { status: $t('ui.' + book.readingStatus), page: book.currentPage ?? '—', percent: book.progressPercent ?? '—' }) }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.rating') }}
                </dt><dd>{{ book.rating ? `${book.rating}/5` : $t('ui.notRated') }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.added') }}
                </dt><dd>{{ new Date(book.addedAt).toLocaleDateString() }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.loanHistory') }}
                </dt><dd>{{ book.loanCount }} {{ book.loanCount ? '(record will be kept)' : '' }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.note') }}
                </dt><dd class="whitespace-pre-wrap break-words">
                  {{ book.note || $t('copy.none') }}
                </dd>
                <dt class="text-muted">
                  {{ $t('ui.description') }}
                </dt><dd class="whitespace-pre-wrap break-words">
                  {{ book.description || $t('copy.none') }}
                </dd>
              </dl>
            </div>
          </UCard>
        </div>
      </UCard>
      <LibraryBulkDeleteModal
        v-model:open="deletionOpen"
        :ids="selectedIds"
        @removed="removedIds.push(...$event)"
      />
    </UPageBody>
  </UContainer>
</template>
