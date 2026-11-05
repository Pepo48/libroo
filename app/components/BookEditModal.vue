<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { BookDetails } from '~~/shared/types/book'
import { BATCH_TAG_UPDATE_MAX_ENTRIES, bookEditSchema, MANUAL_COVER_MAX_BYTES, type BookEditSchema } from '~~/shared/utils/schemas'
import type { BookRefreshSelection } from '~~/shared/types/book-refresh'
import { isValidIsbn } from '~~/shared/utils/isbn'

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ book: BookDetails }>()
const emit = defineEmits<{ saved: [book: BookDetails] }>()
const toast = useToast()
const feedback = ref<{ title: string, description?: string, color: 'success' | 'warning' | 'error' } | null>(null)
const notify = (value: NonNullable<typeof feedback.value>) => {
  feedback.value = value
}
let savedToastId: string | number | undefined
const saving = ref(false)
const preparingCover = ref(false)
const refreshing = ref(false)
const refreshPreviewPending = ref(false)
const coverFile = ref<File | null>(null)
let version = 0
const state = reactive({
  expectedBookId: '', title: '', authors: [''], isbn: '', publisher: '', publishDate: '',
  language: '', series: '', seriesPosition: '', numberOfPages: null as number | null, addTags: [] as string[], description: '',
  coverImage: null as BookEditSchema['coverImage'], removeCover: false
})
const pagesInput = computed<string | number>({
  get: () => state.numberOfPages ?? '',
  set: (value) => { state.numberOfPages = value === '' ? null : Number(value) }
})
const currentTags = computed(() => [...props.book.userTags.map(tag => tag.name), ...state.addTags])
const validIsbn = computed(() => isValidIsbn(state.isbn))
const preview = computed(() => state.coverImage
  ? `data:${state.coverImage.contentType};base64,${state.coverImage.data.replace(/^data:[^,]*,/, '')}`
  : !state.removeCover && props.book.coverPath ? `/api/blob/${props.book.coverPath}` : null)
const errorMessage = (error: unknown) => (error as { data?: { message?: string } })?.data?.message || (error instanceof Error ? error.message : t('ui.pleaseTryAgain'))
watch(open, (value) => {
  version++
  preparingCover.value = false
  refreshing.value = false
  refreshPreviewPending.value = false
  if (!value) return
  feedback.value = null
  if (savedToastId !== undefined) {
    toast.remove(savedToastId)
    savedToastId = undefined
  }
  Object.assign(state, {
    expectedBookId: props.book.bookId, title: props.book.title,
    authors: props.book.authors.length ? props.book.authors.map(author => author.name) : [props.book.author || ''],
    isbn: props.book.isbn || '', publisher: props.book.publishers || '', publishDate: props.book.publishDate || '',
    language: props.book.language ?? '', series: props.book.series ?? '', seriesPosition: props.book.seriesPosition ?? '',
    numberOfPages: props.book.numberOfPages, addTags: [], description: props.book.description || '', coverImage: null, removeCover: false
  })
  coverFile.value = null
}, { immediate: true })

async function upload(file: File | null | undefined) {
  if (!file) return
  const current = ++version
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > MANUAL_COVER_MAX_BYTES) {
    coverFile.value = null
    notify({ title: t('copy.chooseAJpegPngWebpOrGifUpTo2'), color: 'error' })
    return
  }
  preparingCover.value = true
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1]!)
      reader.onerror = () => reject(new Error(t('copy.couldNotReadThisImage')))
      reader.readAsDataURL(file)
    })
    if (current !== version || !open.value) return
    state.coverImage = { data, contentType: file.type, size: file.size }
    state.removeCover = false
  } catch (error) {
    notify({ title: t('copy.couldNotLoadImage'), description: errorMessage(error), color: 'error' })
  } finally {
    if (current === version) preparingCover.value = false
  }
}

function removeCover() {
  version++
  preparingCover.value = false
  state.coverImage = null
  state.removeCover = true
  coverFile.value = null
}
function applyRefresh({ addTags, ...fields }: BookRefreshSelection) {
  Object.assign(state, fields)
  if (addTags) state.addTags = [...state.addTags, ...addTags]
  if (fields.coverImage) {
    state.removeCover = false
    coverFile.value = null
  }
  notify({ title: t('ui.selectedFieldsApplied'), description: t('ui.reviewYourEditsThenSaveYourChanges'), color: 'success' })
}
async function save(event: FormSubmitEvent<BookEditSchema>) {
  if (saving.value || refreshing.value || refreshPreviewPending.value || preparingCover.value) return
  saving.value = true
  try {
    const book = await $fetch<BookDetails>(`/api/books/${props.book.id}`, { method: 'PUT', body: event.data })
    emit('saved', book)
    open.value = false
    savedToastId = toast.add({ title: t('ui.bookUpdated'), color: 'success' }).id
  } catch (error) {
    notify({ title: t('ui.couldNotSaveBook'), description: errorMessage(error), color: 'error' })
  } finally { saving.value = false }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('ui.editBook')"
    :description="$t('ui.changesApplyToThisEntryInYour')"
    :dismissible="!saving"
    :close="!saving"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <UForm
        id="book-edit-form"
        :schema="bookEditSchema"
        :state="state"
        class="space-y-6"
        @submit="save"
      >
        <fieldset
          :disabled="saving"
          class="space-y-6"
        >
          <UFormField
            :label="$t('ui.title')"
            name="title"
            required
          >
            <UInput
              v-model="state.title"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField
            :label="$t('ui.authors')"
            name="authors"
            required
            :description="$t('ui.oneNamePerRowInTheOrder')"
          >
            <div class="space-y-2">
              <div
                v-for="(_, index) in state.authors"
                :key="index"
                class="flex gap-2"
              >
                <UInput
                  v-model="state.authors[index]"
                  :aria-label="`Author ${index + 1}`"
                  class="min-w-0 flex-1"
                />
                <UButton
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  :aria-label="$t('copy.removeAuthorNumber', { number: index + 1 })"
                  :disabled="state.authors.length === 1"
                  @click="state.authors.splice(index, 1)"
                />
              </div>
              <UButton
                :label="$t('ui.addAuthor')"
                icon="i-lucide-plus"
                variant="link"
                size="sm"
                :disabled="state.authors.length >= 20"
                @click="state.authors.push('')"
              />
            </div>
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="ISBN"
              name="isbn"
              :hint="$t('ui.optional')"
            >
              <UInput
                v-model="state.isbn"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('ui.publisher')"
              name="publisher"
            >
              <UInput
                v-model="state.publisher"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('ui.publicationDate')"
              name="publishDate"
              :hint="$t('ui.yearOrDate')"
            >
              <UInput
                v-model="state.publishDate"
                placeholder="e.g. 2015"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('ui.pages')"
              name="numberOfPages"
            >
              <UInput
                v-model.number="pagesInput"
                type="number"
                :min="1"
                :max="100000"
                class="w-full"
              />
            </UFormField>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField
              :label="$t('ui.language')"
              name="language"
            >
              <UInput
                v-model="state.language"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('ui.series')"
              name="series"
            >
              <UInput
                v-model="state.series"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('ui.volume')"
              name="seriesPosition"
            >
              <UInput
                v-model="state.seriesPosition"
                class="w-full"
              />
            </UFormField>
          </div>
          <BookRefreshPanel
            :user-book-id="book.id"
            :isbn="state.isbn"
            :current="state"
            :current-cover="preview"
            :current-tags="currentTags"
            :active="open"
            :disabled="saving || preparingCover"
            :valid-isbn="validIsbn"
            @apply="applyRefresh"
            @busy="refreshing = $event"
            @pending="refreshPreviewPending = $event"
          />
          <UFormField
            :label="$t('ui.description')"
            name="description"
          >
            <UTextarea
              v-model="state.description"
              :rows="4"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('ui.addTags')"
            name="addTags"
            :description="$t('ui.pressEnterToAddATagExisting')"
          >
            <div
              v-if="book.userTags.length"
              class="mb-2 flex flex-wrap gap-1.5"
            >
              <UBadge
                v-for="tag in book.userTags"
                :key="tag.id"
                color="neutral"
                variant="soft"
                :label="tag.name"
              />
            </div>
            <UInputTags
              v-model="state.addTags"
              :max="BATCH_TAG_UPDATE_MAX_ENTRIES"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('ui.cover')"
            name="coverImage"
            :description="$t('ui.uploadYourOwnImageUpTo2')"
          >
            <div class="mt-2 flex flex-col gap-4 sm:flex-row">
              <div class="flex aspect-2/3 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-muted">
                <NuxtImg
                  v-if="preview"
                  :src="preview"
                  :alt="$t('ui.coverPreview')"
                  class="size-full object-contain"
                />
                <UIcon
                  v-else
                  name="i-lucide-book-image"
                  class="size-8 text-dimmed"
                />
              </div>
              <div class="min-w-0 flex-1 space-y-3">
                <UFileUpload
                  v-model="coverFile"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  :label="$t('ui.uploadCover')"
                  :description="$t('ui.jpegPngWebpOrGifUpTo')"
                  class="min-h-24"
                  @update:model-value="upload"
                />
                <div class="flex flex-wrap gap-2">
                  <UButton
                    :label="$t('ui.removeCover')"
                    icon="i-lucide-image-off"
                    variant="ghost"
                    color="neutral"
                    :disabled="!preview"
                    @click="removeCover"
                  />
                </div>
              </div>
            </div>
          </UFormField>
        </fieldset>
      </UForm>
    </template>
    <template #footer>
      <div class="w-full space-y-3">
        <UAlert
          v-if="feedback"
          :title="feedback.title"
          :description="feedback.description"
          :color="feedback.color"
          variant="soft"
        />
        <p
          v-if="refreshPreviewPending"
          class="text-sm text-muted"
        >
          {{ $t('ui.applySelectedFieldsOrDismissThePreview') }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            :label="$t('ui.cancel')"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="open = false"
          />
          <UButton
            :label="$t('ui.saveChanges')"
            form="book-edit-form"
            type="submit"
            :loading="saving"
            :disabled="refreshing || refreshPreviewPending || preparingCover"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
