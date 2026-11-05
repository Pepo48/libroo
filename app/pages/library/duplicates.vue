<script setup lang="ts">
import type { DuplicateBookGroup } from '~~/shared/types/library-cleanup'

const { t } = useI18n()

usePageTitle(() => t('ui.reviewDuplicates'))
const { data: groups, status, error, refresh } = await useFetch<DuplicateBookGroup[]>('/api/library/duplicates')
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
        v-else-if="status === 'pending'"
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
        {{ visibleGroups.length }} {{ visibleGroups.length === 1 ? 'group' : 'groups' }} across your library, including wishlist and previously owned books. Choose a record to keep and select the groups to clean up.
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
                {{ group.books[0]!.authors.join(', ') }} · {{ group.books.length }} records
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
                  :alt="`Cover of ${book.title}`"
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
                    {{ book.libraryState.replaceAll('_', ' ') }} · {{ book.location || $t('ui.noLocation') }}
                  </p>
                  <UButton
                    :variant="keep[group.key] === book.id ? 'solid' : 'outline'"
                    :aria-pressed="keep[group.key] === book.id"
                    @click="keep[group.key] = book.id"
                  >
                    {{ keep[group.key] === book.id ? 'Keeping this record' : 'Keep this record' }}
                  </UButton>
                </div>
              </div>
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-muted">
                  ISBN
                </dt><dd>{{ book.isbn || 'None' }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.tags') }}
                </dt><dd>{{ book.tags.join(', ') || 'None' }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.edition') }}
                </dt><dd>{{ [book.publishDate, book.publishers, book.numberOfPages ? `${book.numberOfPages} pages` : null].filter(Boolean).join(' · ') || 'None' }}</dd>
                <dt class="text-muted">
                  {{ $t('ui.reading') }}
                </dt><dd>{{ book.readingStatus }} · page {{ book.currentPage ?? '—' }} · {{ book.progressPercent ?? '—' }}%</dd>
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
                  {{ book.note || 'None' }}
                </dd>
                <dt class="text-muted">
                  {{ $t('ui.description') }}
                </dt><dd class="whitespace-pre-wrap break-words">
                  {{ book.description || 'None' }}
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
