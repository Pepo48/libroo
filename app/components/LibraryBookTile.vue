<script setup lang="ts">
import type { LibraryBook } from '~~/shared/types/book'

defineProps<{ book: LibraryBook, selectionMode?: boolean, selected?: boolean }>()
const emit = defineEmits<{
  select: [id: string, checked: boolean | 'indeterminate']
  tag: [tag: string]
}>()
</script>

<template>
  <div class="relative min-w-0">
    <div
      v-if="selectionMode"
      class="absolute top-2 right-2 z-20 rounded-md bg-default/90 p-1.5 shadow-sm ring-1 ring-default"
    >
      <UCheckbox
        :model-value="selected"
        :aria-label="`Select ${book.title}`"
        @update:model-value="emit('select', book.id, $event)"
      />
    </div>
    <BookCard
      :id="book.id"
      :book-id="book.bookId"
      :title="book.title"
      :author="book.author"
      :isbn="book.isbn"
      :cover-path="book.coverPath"
      :location="book.location"
      :last-known-location="book.lastKnownLocation"
      :added-at="book.addedAt"
      :active-loan="book.activeLoan"
      :library-state="book.libraryState"
      :tags="book.tags"
      :enrichment-status="book.enrichmentStatus"
      @tag-selected="emit('tag', $event)"
    />
  </div>
</template>
