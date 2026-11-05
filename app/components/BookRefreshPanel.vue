<script setup lang="ts">
import { normalizeTagInput } from '~~/shared/utils/tag-ingestion'
import type { BookMetadataSourceInfo, BookRefreshFields, BookRefreshPreview, BookRefreshSelection } from '~~/shared/types/book-refresh'

const { t } = useI18n()

const props = defineProps<{ userBookId: string, isbn: string, current: BookRefreshFields, currentCover: string | null, currentTags: string[], active: boolean, disabled: boolean, validIsbn: boolean }>()
const emit = defineEmits<{ apply: [value: BookRefreshSelection], busy: [value: boolean], pending: [value: boolean] }>()
const sources = ref<BookMetadataSourceInfo[]>([])
const source = ref('auto')
const loading = ref(false)
const sourceError = ref(false)
const error = ref('')
const result = ref<BookRefreshPreview | null>(null)
const coverImage = computed(() => result.value?.coverImage)
const useCover = ref(false)
const checkedTags = ref<string[]>([])
const suggestedTags = computed(() => {
  const existing = new Set(props.currentTags.map(tag => normalizeTagInput(tag)?.key))
  return (result.value?.suggestedTags ?? []).filter(tag => !existing.has(normalizeTagInput(tag)?.key))
})
const tagsToApply = computed(() => suggestedTags.value.filter(tag => checkedTags.value.includes(tag)))
const fetchedCover = computed(() => {
  const image = coverImage.value
  if (!image) return null
  const url = `data:${image.contentType};base64,${image.data}`
  return url === props.currentCover ? null : url
})
const selected = reactive<Record<string, boolean>>({})
const fields = computed(() => [
  { key: 'title', label: t('ui.title') }, { key: 'authors', label: t('ui.authors') },
  { key: 'publisher', label: t('ui.publisher') }, { key: 'publishDate', label: t('ui.publicationDate') },
  { key: 'numberOfPages', label: t('ui.pages') }, { key: 'description', label: t('ui.description') },
  { key: 'language', label: t('ui.language') }, { key: 'series', label: t('ui.series') },
  { key: 'seriesPosition', label: t('ui.volume') }
] as const)
const editionFacts = computed(() => {
  const edition = result.value?.editionDetails
  if (!edition) return []
  return [
    { label: t('ui.originalTitle'), value: edition.originalTitle },
    { label: t('ui.edition'), value: edition.edition },
    { label: t('ui.translators'), value: edition.translators?.join(' · ') },
    { label: t('ui.format'), value: edition.format },
    { label: t('ui.binding'), value: edition.binding }
  ].filter(fact => fact.value)
})
const options = computed(() => [{ label: t('ui.automatic'), value: 'auto' }, ...sources.value.map(item => ({ label: item.label, value: item.id }))])
const display = (value: unknown) => Array.isArray(value) ? value.join(', ') : value == null || value === '' ? t('ui.notSet') : String(value)
const changes = computed(() => fields.value.filter(field => result.value?.metadata[field.key] != null && display(result.value.metadata[field.key]) !== display(props.current[field.key])))
const selectedCount = computed(() => changes.value.filter(field => selected[field.key]).length + Number(!!fetchedCover.value && useCover.value) + tagsToApply.value.length)
let controller: AbortController | undefined
let requestId = 0
function clear() {
  requestId++
  controller?.abort()
  result.value = null
  error.value = ''
  useCover.value = false
  checkedTags.value = []
  loading.value = false
  emit('busy', false)
  emit('pending', false)
}
watch([() => props.active, () => props.isbn, () => props.userBookId, source], clear)
onBeforeUnmount(clear)
watch(() => props.active, async (active) => {
  if (!active) return
  try {
    sources.value = await $fetch<BookMetadataSourceInfo[]>('/api/books/metadata-sources')
    sourceError.value = false
  } catch {
    sourceError.value = true
  }
}, { immediate: true })
async function refresh() {
  if (!props.validIsbn || loading.value || props.disabled) return
  clear()
  const current = requestId
  controller = new AbortController()
  loading.value = true
  emit('busy', true)
  try {
    const preview = await $fetch<BookRefreshPreview>(`/api/books/${props.userBookId}/metadata-preview`, {
      method: 'POST', body: { isbn: props.isbn, source: source.value, includeCover: true }, signal: controller.signal
    })
    if (current !== requestId || !props.active) return
    result.value = preview
    useCover.value = !props.currentCover
    emit('pending', true)
    for (const field of fields.value) {
      const existing = props.current[field.key]
      selected[field.key] = existing == null || existing === '' || (Array.isArray(existing) && existing.every(value => !value.trim()))
    }
  } catch (cause) {
    if (current === requestId) error.value = (cause as { data?: { message?: string } })?.data?.message || t('ui.couldNotRefreshThisBookPleaseTry')
  } finally {
    if (current === requestId) {
      loading.value = false
      emit('busy', false)
    }
  }
}
function apply() {
  if (!result.value || props.disabled) return
  const values: BookRefreshSelection = {}
  for (const field of changes.value) {
    if (selected[field.key]) Object.assign(values, { [field.key]: result.value.metadata[field.key] })
  }
  if (useCover.value && fetchedCover.value && coverImage.value) values.coverImage = coverImage.value
  if (tagsToApply.value.length) values.addTags = tagsToApply.value
  emit('apply', values)
  clear()
}
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <template #header>
      <h3 class="font-semibold">
        {{ $t('ui.refreshFromSources') }}
      </h3>
      <p class="mt-1 text-sm text-muted">
        {{ $t('ui.lookUpThisIsbnAgainAndCompare') }}
      </p>
    </template>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <UFormField
        :label="$t('ui.metadataSource')"
        class="min-w-0 flex-1"
      >
        <USelect
          v-model="source"
          :items="options"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>
      <UButton
        :label="$t('ui.refreshFromSources')"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        :disabled="!validIsbn || disabled"
        @click="refresh"
      />
    </div>
    <p
      v-if="!validIsbn"
      class="text-sm text-muted"
    >
      {{ $t('ui.enterAValidIsbnAboveToRefresh') }}
    </p>
    <p
      v-if="sourceError"
      class="text-sm text-warning"
    >
      {{ $t('ui.theSourceListCouldNotBeLoaded') }}
    </p>
    <UAlert
      v-if="error"
      :description="error"
      color="error"
      variant="soft"
    />
    <template v-if="result">
      <UAlert
        v-if="result.warnings.length"
        :title="$t('ui.someDetailsCouldNotBeFetched')"
        :description="result.warnings.join(' ')"
        color="warning"
        variant="soft"
      />
      <p class="text-sm font-medium">
        {{ result.source ? $t('refresh.source', { source: result.source.label }) : $t('ui.noMatchingMetadataFoundForThisIsbn') }}
      </p>
      <UButton
        v-if="result.catalogUrl"
        :to="result.catalogUrl"
        target="_blank"
        rel="noopener noreferrer"
        :label="$t('ui.viewCatalogRecord')"
        trailing-icon="i-lucide-external-link"
        variant="link"
        color="neutral"
        class="p-0"
      />
      <div
        v-if="editionFacts.length"
        class="space-y-2 border-t border-default pt-3"
      >
        <p class="text-sm font-medium">
          {{ $t('ui.catalogReference') }}
        </p>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div
            v-for="fact in editionFacts"
            :key="fact.label"
            class="min-w-0"
          >
            <dt class="text-muted">
              {{ fact.label }}
            </dt>
            <dd class="wrap-anywhere">
              {{ fact.value }}
            </dd>
          </div>
        </dl>
      </div>
      <div
        v-for="field in changes"
        :key="field.key"
        class="space-y-2 border-t border-default pt-3"
      >
        <UCheckbox
          v-model="selected[field.key]"
          :label="$t('refresh.useField', { field: field.label.toLowerCase() })"
          :disabled="disabled"
        />
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="font-medium text-muted">
              {{ $t('refresh.currentField', { field: field.label.toLowerCase() }) }}
            </dt>
            <dd class="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap wrap-anywhere">
              {{ display(current[field.key]) }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="font-medium text-muted">
              {{ $t('refresh.fetchedField', { field: field.label.toLowerCase() }) }}
            </dt>
            <dd class="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap wrap-anywhere">
              {{ display(result.metadata[field.key]) }}
            </dd>
          </div>
        </dl>
      </div>
      <div
        v-if="fetchedCover"
        class="space-y-3 border-t border-default pt-3"
      >
        <UCheckbox
          v-model="useCover"
          :label="$t('ui.useFetchedCover')"
          :disabled="disabled"
        />
        <div class="flex flex-wrap gap-6 text-sm">
          <div class="space-y-1">
            <p class="font-medium text-muted">
              {{ $t('ui.currentCover') }}
            </p>
            <NuxtImg
              v-if="currentCover"
              :src="currentCover"
              :alt="$t('ui.currentCover')"
              class="aspect-2/3 w-24 rounded border border-default object-contain"
            />
            <p v-else>
              {{ $t('ui.noCover') }}
            </p>
          </div>
          <div class="space-y-1">
            <p class="font-medium text-muted">
              {{ result.coverSource ? $t('refresh.coverFrom', { source: result.coverSource.label }) : $t('ui.fetchedCover') }}
            </p>
            <NuxtImg
              :src="fetchedCover"
              :alt="$t('ui.fetchedCover')"
              class="aspect-2/3 w-24 rounded border border-default object-contain"
            />
          </div>
        </div>
      </div>
      <UFormField
        v-if="suggestedTags.length"
        :label="$t('ui.suggestedTags')"
        :description="$t('ui.chooseTheSubjectsOrGenresYouWant')"
        class="border-t border-default pt-3"
      >
        <UCheckboxGroup
          v-model="checkedTags"
          :items="suggestedTags"
          :disabled="disabled"
        />
      </UFormField>
      <p class="text-sm text-muted">
        {{ $t('ui.existingValuesAreKeptUnlessSelectedMissing') }}
      </p>
      <p
        v-if="result.source && !changes.length && !fetchedCover && !suggestedTags.length"
        class="text-sm text-muted"
      >
        {{ $t('ui.theAvailableMetadataMatchesYourCurrentValues') }}
      </p>
      <UButton
        :label="$t('ui.applySelectedFields')"
        variant="soft"
        :disabled="!selectedCount || disabled"
        @click="apply"
      />
      <UButton
        :label="$t('ui.dismissPreview')"
        variant="ghost"
        color="neutral"
        :disabled="disabled"
        @click="clear"
      />
      <p class="text-sm text-muted">
        {{ $t('ui.nothingIsSavedUntilYouChooseSave') }}
      </p>
    </template>
  </UCard>
</template>
