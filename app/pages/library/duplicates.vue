<script setup lang="ts">
import type { DuplicateBookGroup } from '~~/shared/types/library-cleanup'

usePageTitle('Review duplicates')
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
      title="Review duplicates"
      description="Review matching records across owned, wishlisted and previously owned books, regardless of your library view. Choose which records to keep."
    >
      <template #links>
        <UButton
          to="/library?libraryState=owned,wishlisted,previously_owned"
          color="neutral"
          variant="outline"
          icon="i-lucide-library"
        >
          Show all books
        </UButton>
        <UButton
          to="/settings#library-data"
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
        >
          Export a backup
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="reload"
        >
          Refresh
        </UButton>
        <UButton
          color="error"
          :disabled="!selectedIds.length"
          @click="deletionOpen = true"
        >
          Delete {{ selectedIds.length }} {{ selectedIds.length === 1 ? 'duplicate' : 'duplicates' }}
        </UButton>
      </template>
    </UPageHeader>
    <UPageBody>
      <UAlert
        color="info"
        title="Review before deleting"
        description="Matching titles and authors may represent different editions or physical copies. Nothing is selected automatically. Fields are not merged: keep the record with the cover, notes, tags and progress you want. Records with any loan history are kept."
      />
      <UAlert
        v-if="error"
        color="error"
        title="Unable to load duplicates"
        description="Please try refreshing this page."
      />
      <p
        v-else-if="status === 'pending'"
        role="status"
      >
        Checking your library…
      </p>
      <UEmpty
        v-else-if="!visibleGroups.length"
        title="No duplicate candidates"
        description="No repeated title-and-author combinations were found in your library."
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
              label="Clean up this group"
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
                  >View book details</NuxtLink>
                  <p class="text-sm">
                    {{ book.libraryState.replaceAll('_', ' ') }} · {{ book.location || 'No location' }}
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
                  Tags
                </dt><dd>{{ book.tags.join(', ') || 'None' }}</dd>
                <dt class="text-muted">
                  Edition
                </dt><dd>{{ [book.publishDate, book.publishers, book.numberOfPages ? `${book.numberOfPages} pages` : null].filter(Boolean).join(' · ') || 'None' }}</dd>
                <dt class="text-muted">
                  Reading
                </dt><dd>{{ book.readingStatus }} · page {{ book.currentPage ?? '—' }} · {{ book.progressPercent ?? '—' }}%</dd>
                <dt class="text-muted">
                  Rating
                </dt><dd>{{ book.rating ? `${book.rating}/5` : 'Not rated' }}</dd>
                <dt class="text-muted">
                  Added
                </dt><dd>{{ new Date(book.addedAt).toLocaleDateString() }}</dd>
                <dt class="text-muted">
                  Loan history
                </dt><dd>{{ book.loanCount }} {{ book.loanCount ? '(record will be kept)' : '' }}</dd>
                <dt class="text-muted">
                  Note
                </dt><dd class="whitespace-pre-wrap break-words">
                  {{ book.note || 'None' }}
                </dd>
                <dt class="text-muted">
                  Description
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
