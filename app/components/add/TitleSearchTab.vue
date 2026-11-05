<script setup lang="ts">
import type { BookSearchEdition, BookSearchResult } from '~~/shared/types/book-search'
import { getApiErrorMessage } from '~~/shared/utils/api-error'

const { t } = useI18n()

const state = reactive({ query: '' })
const result = ref<BookSearchResult | null>(null)
const attributions = computed(() => [...new Map((result.value?.books ?? []).flatMap(book => book.source?.attribution ? [[book.source.attribution.url, book.source.attribution] as const] : [])).values()])
const selectedIsbn = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | undefined
let version = 0

async function search() {
  controller?.abort()
  controller = new AbortController()
  const requestVersion = ++version
  loading.value = true
  error.value = null
  result.value = null
  try {
    const response = await $fetch<BookSearchResult>('/api/books/search', {
      method: 'POST', body: { query: state.query.trim() }, signal: controller.signal
    })
    if (requestVersion === version) result.value = response
  } catch (err) {
    if (requestVersion === version) error.value = getApiErrorMessage(err, t('copy.couldNotSearchTheCatalogPleaseTryAgain'))
  } finally {
    if (requestVersion === version) loading.value = false
  }
}
function select(book: BookSearchEdition) {
  selectedIsbn.value = book.isbn
}
function reset() {
  version++
  controller?.abort()
  state.query = ''
  result.value = null
  selectedIsbn.value = null
  error.value = null
  loading.value = false
}
onBeforeUnmount(reset)
defineExpose({ reset })
</script>

<template>
  <div class="space-y-4">
    <template v-if="selectedIsbn">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        @click="selectedIsbn = null"
      >
        {{ $t('ui.backToTitleResults') }}
      </UButton>
      <AddIsbnLookupTab :initial-isbn="selectedIsbn" />
    </template>
    <template v-else>
      <UCard>
        <template #header>
          <span class="font-semibold">{{ $t('ui.findBookByTitle') }}</span>
        </template>
        <UForm
          :state="state"
          class="space-y-4"
          @submit="search"
        >
          <UFormField
            :label="$t('ui.bookTitle')"
            name="query"
            required
          >
            <UInput
              v-model="state.query"
              :placeholder="$t('ui.eGHarryPotter')"
              :maxlength="120"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <p class="text-sm text-muted">
            {{ $t('ui.searchTheAvailableBookCatalogsEnterAt') }}
          </p>
          <UButton
            type="submit"
            icon="i-lucide-search"
            block
            size="lg"
            :loading="loading"
            :disabled="state.query.trim().length < 3"
          >
            {{ $t('ui.searchByTitle') }}
          </UButton>
        </UForm>
      </UCard>
      <UAlert
        v-if="result?.warnings?.length"
        color="warning"
        :description="result.warnings.join(' ')"
      />
      <UAlert
        v-if="error"
        color="error"
        :description="error"
      />
      <UAlert
        v-else-if="result && !result.books.length"
        color="neutral"
        :title="$t('ui.noMatchingBooks')"
        :description="result.hasMore ? $t('copy.thisSearchIsTooBroadAddMoreWordsToNarrow') : $t('copy.tryFewerWordsSearchByIsbnOrAddTheBook')"
      />
      <UCard v-if="result?.books.length">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold">{{ $t('ui.chooseAnEdition') }}</span>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ $t('ui.catalogResults') }}
            </UBadge>
          </div>
        </template>
        <ul class="divide-y divide-default">
          <li
            v-for="book in result.books"
            :key="book.isbn"
          >
            <UButton
              color="neutral"
              variant="ghost"
              block
              class="justify-start py-3 text-left"
              @click="select(book)"
            >
              <div class="min-w-0 whitespace-normal">
                <p class="font-semibold">
                  {{ book.title }}<span v-if="book.part"> — {{ book.part }}</span>
                </p>
                <p
                  v-if="book.author"
                  class="text-sm text-muted"
                >
                  {{ book.author }}
                </p>
                <p class="text-sm text-muted">
                  {{ [book.publisher, book.year].filter(Boolean).join(' · ') }}
                </p>
                <p class="text-xs text-muted">
                  ISBN {{ book.isbn }} · {{ book.source?.label }}
                </p>
              </div>
            </UButton>
          </li>
        </ul>
        <template #footer>
          <p
            v-if="result.hasMore"
            class="text-sm text-muted"
          >
            {{ $t('ui.moreEditionsMatchAddMoreWordsTo') }}
          </p>
          <ULink
            v-for="credit in attributions"
            :key="credit.url"
            :to="credit.url"
            target="_blank"
            class="block text-xs text-muted"
          >{{ credit.label }}</ULink>
        </template>
      </UCard>
    </template>
  </div>
</template>
