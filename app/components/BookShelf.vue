<script setup lang="ts">
import type { LibraryBook } from '~~/shared/types/book'

const props = defineProps<{ title: string, books: LibraryBook[], moreLoaded?: boolean, revealBookId?: string | null }>()
const carousel = useTemplateRef('carousel')
const shelfRoot = useTemplateRef<HTMLElement>('shelfRoot')

async function revealNewBooks() {
  if (!props.revealBookId) return
  await nextTick()
  const index = props.books.findIndex(book => book.id === props.revealBookId)
  const api = carousel.value?.emblaApi
  if (index < 0 || !api) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  api.reInit()
  api.scrollTo(index, reducedMotion)
  shelfRoot.value?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
}
watch(() => props.revealBookId, revealNewBooks, { flush: 'post' })
onMounted(revealNewBooks)
const emit = defineEmits<{ tag: [tag: string] }>()
</script>

<template>
  <section
    ref="shelfRoot"
    :aria-label="title"
    class="min-w-0 space-y-4"
  >
    <div class="flex min-h-8 items-center gap-3 pr-24">
      <span
        class="h-5 w-1 rounded-full bg-primary"
        aria-hidden="true"
      />
      <h2 class="text-lg font-semibold tracking-tight text-highlighted sm:text-xl">
        {{ title }}
      </h2>
      <span class="shrink-0 text-xs text-muted">{{ books.length }} {{ moreLoaded ? 'loaded' : books.length === 1 ? 'book' : 'books' }}</span>
    </div>
    <UCarousel
      ref="carousel"
      v-slot="{ item }"
      :items="books"
      arrows
      align="start"
      :slides-to-scroll="1"
      :prev="{ color: 'neutral', variant: 'outline', size: 'sm', class: 'rounded-full' }"
      :next="{ color: 'neutral', variant: 'outline', size: 'sm', class: 'rounded-full' }"
      :aria-label="`${title} books`"
      :ui="{
        root: 'relative',
        viewport: 'overflow-hidden pt-1 pb-2',
        container: '-ms-4',
        item: 'basis-[46%] ps-4 sm:basis-1/4 md:basis-1/5 lg:basis-1/6',
        controls: 'absolute -top-12 end-0',
        arrows: 'flex gap-2',
        prev: 'static translate-none',
        next: 'static translate-none'
      }"
    >
      <LibraryBookTile
        :book="item"
        @tag="emit('tag', $event)"
      />
    </UCarousel>
  </section>
</template>
