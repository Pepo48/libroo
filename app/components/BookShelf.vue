<script setup lang="ts">
import type { LibraryBook } from '~~/shared/types/book'

const props = defineProps<{ title: string, books: LibraryBook[], hasMore?: boolean, loading?: boolean, revealBookId?: string }>()
const emit = defineEmits<{ tag: [tag: string], loadMore: [] }>()
const carousel = useTemplateRef('carousel')
const canGoBack = ref(false)
const canGoForward = ref(false)
let previousSnap = 0
let revealing = false

function onSelect(index: number) {
  const api = carousel.value?.emblaApi
  canGoBack.value = api?.canScrollPrev() ?? false
  canGoForward.value = api?.canScrollNext() ?? false
  const movedForward = index > previousSnap
  previousSnap = index
  if (!revealing && movedForward && !canGoForward.value && props.hasMore && !props.loading) emit('loadMore')
}

function goForward() {
  const api = carousel.value?.emblaApi
  if (api?.canScrollNext()) api.scrollNext()
  else if (props.hasMore && !props.loading) emit('loadMore')
}

watch(() => props.revealBookId, async (id) => {
  if (!id) return
  await nextTick()
  const index = props.books.findIndex(book => book.id === id)
  const api = carousel.value?.emblaApi
  if (index < 0 || !api) return
  revealing = true
  api.reInit()
  api.scrollTo(index, window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  revealing = false
}, { flush: 'post' })
</script>

<template>
  <section
    :aria-label="title"
    class="min-w-0 space-y-4"
  >
    <div class="flex min-h-8 items-center gap-3">
      <span
        class="h-5 w-1 rounded-full bg-primary"
        aria-hidden="true"
      />
      <h2 class="text-lg font-semibold tracking-tight text-highlighted sm:text-xl">
        {{ title }}
      </h2>
      <span class="shrink-0 text-xs text-muted">{{ hasMore ? $t('library.loadedBooks', { count: books.length }) : $t('library.bookCount', books.length) }}</span>
      <div class="ms-auto flex shrink-0 gap-2">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          size="sm"
          class="rounded-full"
          :aria-label="$t('ui.previousBooks')"
          :disabled="!canGoBack"
          @click="carousel?.emblaApi?.scrollPrev()"
        />
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          size="sm"
          class="rounded-full"
          :aria-label="$t('ui.nextBooks')"
          :loading="loading"
          :disabled="!canGoForward && !hasMore"
          @click="goForward"
        />
      </div>
    </div>
    <UCarousel
      ref="carousel"
      v-slot="{ item }"
      :items="books"
      align="start"
      :slides-to-scroll="1"
      :aria-label="$t('library.shelfLabel', { title })"
      :ui="{
        root: 'relative',
        viewport: 'overflow-hidden pt-1 pb-2',
        container: '-ms-4',
        item: 'basis-[46%] ps-4 sm:basis-1/4 md:basis-1/5 lg:basis-1/6'
      }"
      wheel-gestures
      @select="onSelect"
    >
      <LibraryBookTile
        :book="item"
        @tag="emit('tag', $event)"
      />
    </UCarousel>
  </section>
</template>
