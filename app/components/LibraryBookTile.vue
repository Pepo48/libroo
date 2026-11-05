<script setup lang="ts">
import type { LibraryBook } from '~~/shared/types/book'

defineProps<{ book: LibraryBook, selectionMode?: boolean, selected?: boolean }>()
const emit = defineEmits<{
  select: [id: string, checked: boolean | 'indeterminate']
  tag: [tag: string]
}>()
</script>

<template>
  <div class="min-w-0">
    <div
      v-if="selectionMode"
      class="mb-2 rounded-lg border border-default bg-elevated p-2"
    >
      <UCheckbox
        :model-value="selected"
        :label="`Select ${book.title}`"
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
