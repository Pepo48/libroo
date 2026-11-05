<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { LibraryBook, LibraryState, ReadingStatus } from '~~/shared/types/book'
import { MANUAL_COVER_MAX_BYTES, manualBookCreateSchema, type ManualBookCreateSchema } from '~~/shared/utils/schemas'

const { t } = useI18n()
const { libraryStateItems } = useLibraryStateOptions()

const toast = useToast()
const dashboardStore = useLibraryDashboardStore()
const { addBook, getLoadedPages, markNeedsSync } = dashboardStore

const isSaving = ref(false)
const tagInput = ref('')
const coverFile = ref<File | null>(null)
const coverPreviewUrl = ref<string | null>(null)

const formState = reactive({
  title: '',
  authors: [''],
  isbn: '',
  libraryState: 'owned' as LibraryState,
  coverImage: null as { data: string, contentType: string, size: number } | null,
  publishDate: '',
  publisher: '',
  numberOfPages: null as number | null,
  tags: [] as string[],
  rating: null as number | null,
  note: '',
  readingStatus: 'unread' as ReadingStatus,
  currentPage: null as number | null,
  progressPercent: null as number | null
})

const readingStatusItems = [
  { label: t('ui.unread'), value: 'unread' },
  { label: t('ui.reading'), value: 'reading' },
  { label: t('ui.read'), value: 'read' }
]

const ratingItems = [
  { label: 'Unrated', value: null },
  { label: '1 star', value: 1 },
  { label: '2 stars', value: 2 },
  { label: '3 stars', value: 3 },
  { label: '4 stars', value: 4 },
  { label: '5 stars', value: 5 }
]

const isOwnedBook = computed(() => formState.libraryState === 'owned')

watch(tagInput, (value) => {
  formState.tags = value
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
})

function addAuthor() {
  formState.authors.push('')
}

const maxCoverSizeLabel = computed(() => formatFileSize(MANUAL_COVER_MAX_BYTES))

function removeAuthor(index: number) {
  if (formState.authors.length === 1) {
    formState.authors[0] = ''
    return
  }
  formState.authors.splice(index, 1)
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
}

function clearCover() {
  formState.coverImage = null
  coverFile.value = null
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value)
    coverPreviewUrl.value = null
  }
}

function readCoverFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error(t('copy.coverImageCouldNotBeRead')))
    }
    reader.onerror = () => reject(new Error(t('copy.coverImageCouldNotBeRead')))
    reader.readAsDataURL(file)
  })
}

async function prepareCover(file: File | null) {
  formState.coverImage = null
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value)
    coverPreviewUrl.value = null
  }
  if (!file) return

  if (!file.type.startsWith('image/')) {
    coverFile.value = null
    toast.add({
      title: t('copy.invalidCover'),
      description: t('copy.chooseAnImageFileForTheCover'),
      color: 'error'
    })
    return
  }

  if (file.size > MANUAL_COVER_MAX_BYTES) {
    coverFile.value = null
    toast.add({
      title: t('copy.coverIsTooLarge'),
      description: t('copy.chooseSmallerCover', { size: maxCoverSizeLabel.value }),
      color: 'error'
    })
    return
  }

  const data = await readCoverFile(file)

  formState.coverImage = {
    data,
    contentType: file.type,
    size: file.size
  }
  coverPreviewUrl.value = URL.createObjectURL(file)
}

watch(coverFile, (file) => {
  prepareCover(file).catch((err: unknown) => {
    coverFile.value = null
    toast.add({
      title: t('copy.couldNotReadCover'),
      description: err instanceof Error ? err.message : t('copy.chooseADifferentImageFile'),
      color: 'error'
    })
  })
})

onUnmounted(() => {
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value)
  }
})

async function createBook(payload: FormSubmitEvent<ManualBookCreateSchema>) {
  isSaving.value = true

  try {
    const loadedPagesBeforeAdd = getLoadedPages()
    const addedBook = await $fetch<LibraryBook>('/api/books/manual', {
      method: 'POST',
      body: payload.data
    })

    addBook(addedBook)
    markNeedsSync(loadedPagesBeforeAdd)

    toast.add({
      title: t('copy.bookAdded208'),
      description: t('copy.titleAddedToLibrary', { title: addedBook.title }),
      color: 'success'
    })

    navigateTo(`/library/${addedBook.id}`)
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : t('copy.failedToAddBook'))
    toast.add({
      title: t('copy.failedToAddBook'),
      description: message,
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

function reset() {
  formState.title = ''
  formState.authors = ['']
  formState.isbn = ''
  formState.libraryState = 'owned'
  formState.coverImage = null
  formState.publishDate = ''
  formState.publisher = ''
  formState.numberOfPages = null
  formState.tags = []
  formState.rating = null
  formState.note = ''
  formState.readingStatus = 'unread'
  formState.currentPage = null
  formState.progressPercent = null
  tagInput.value = ''
  clearCover()
}

defineExpose({ reset })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-pencil-line"
          class="text-lg"
        />
        <span class="font-semibold">{{ $t('ui.manualEntry') }}</span>
      </div>
    </template>

    <UForm
      :schema="manualBookCreateSchema"
      :state="formState"
      class="space-y-5"
      @submit="createBook"
    >
      <UFormField
        :label="$t('ui.title')"
        name="title"
        required
      >
        <UInput
          v-model="formState.title"
          class="w-full"
          :placeholder="$t('ui.bookTitle')"
        />
      </UFormField>

      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <label class="text-sm font-medium">{{ $t('ui.authors') }}</label>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-plus"
            @click="addAuthor"
          >
            {{ $t('ui.author') }}
          </UButton>
        </div>
        <UFormField name="authors">
          <div class="space-y-2">
            <div
              v-for="(_, index) in formState.authors"
              :key="index"
              class="flex gap-2"
            >
              <UInput
                v-model="formState.authors[index]"
                class="min-w-0 flex-1"
                :placeholder="index === 0 ? $t('copy.authorName') : $t('copy.additionalAuthor')"
              />
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="$t('copy.removeAuthorNumber', { number: index + 1 })"
                @click="removeAuthor(index)"
              />
            </div>
          </div>
        </UFormField>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="ISBN"
          name="isbn"
        >
          <UInput
            v-model="formState.isbn"
            class="w-full"
            :placeholder="$t('ui.optional')"
          />
        </UFormField>

        <UFormField
          :label="$t('ui.bookState')"
          name="libraryState"
        >
          <USelect
            v-model="formState.libraryState"
            :items="libraryStateItems"
            class="w-full"
          />
        </UFormField>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          :label="$t('ui.publishDate')"
          name="publishDate"
        >
          <UInput
            v-model="formState.publishDate"
            class="w-full"
            :placeholder="$t('ui.yearOrDate')"
          />
        </UFormField>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          :label="$t('ui.publisher')"
          name="publisher"
        >
          <UInput
            v-model="formState.publisher"
            class="w-full"
            :placeholder="$t('ui.optional')"
          />
        </UFormField>

        <UFormField
          :label="$t('ui.pageCount')"
          name="numberOfPages"
        >
          <UInputNumber
            v-model="formState.numberOfPages"
            class="w-full"
            :min="1"
          />
        </UFormField>
      </div>

      <UFormField
        :label="$t('ui.cover')"
        name="coverImage"
      >
        <UFileUpload
          v-model="coverFile"
          accept="image/*"
          class="w-full"
          icon="i-lucide-image-plus"
          :label="$t('ui.dropACoverImageHere')"
          :description="$t('copy.coverImageFormats', { size: maxCoverSizeLabel })"
          :reset="true"
          :multiple="false"
          :preview="false"
        />

        <div
          v-if="coverPreviewUrl"
          class="mt-3 flex items-start gap-3"
        >
          <div class="w-24 overflow-hidden rounded-md border border-default bg-muted">
            <img
              :src="coverPreviewUrl"
              :alt="$t('ui.selectedCoverPreview')"
              class="aspect-[2/3] w-full object-cover"
            >
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="text-sm font-medium truncate">
              {{ coverFile?.name }}
            </div>
            <div
              v-if="coverFile"
              class="text-xs text-muted"
            >
              {{ formatFileSize(coverFile.size) }}
            </div>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="clearCover"
            >
              {{ $t('ui.removeCover') }}
            </UButton>
          </div>
        </div>
      </UFormField>

      <UFormField
        :label="$t('ui.tags')"
        name="tags"
      >
        <UInput
          v-model="tagInput"
          class="w-full"
          :placeholder="$t('ui.favoritesHistorySigned')"
        />
      </UFormField>

      <div
        v-if="isOwnedBook"
        class="grid gap-4 sm:grid-cols-2"
      >
        <UFormField
          :label="$t('ui.readingStatus')"
          name="readingStatus"
        >
          <USelect
            v-model="formState.readingStatus"
            :items="readingStatusItems"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="$t('ui.rating')"
          name="rating"
        >
          <USelect
            v-model="formState.rating"
            :items="ratingItems"
            class="w-full"
          />
        </UFormField>
      </div>

      <div
        v-if="isOwnedBook"
        class="grid gap-4 sm:grid-cols-2"
      >
        <UFormField
          :label="$t('ui.currentPage')"
          name="currentPage"
        >
          <UInputNumber
            v-model="formState.currentPage"
            class="w-full"
            :min="0"
          />
        </UFormField>

        <UFormField
          :label="$t('ui.progress')"
          name="progressPercent"
        >
          <UInputNumber
            v-model="formState.progressPercent"
            class="w-full"
            :min="0"
            :max="100"
          />
        </UFormField>
      </div>

      <UFormField
        :label="$t('ui.note')"
        name="note"
      >
        <UTextarea
          v-model="formState.note"
          class="w-full"
          :rows="4"
          :placeholder="$t('ui.privateNote')"
        />
      </UFormField>

      <UButton
        type="submit"
        icon="i-lucide-book-plus"
        block
        size="lg"
        :loading="isSaving"
      >
        {{ $t('ui.addBook') }}
      </UButton>
    </UForm>
  </UCard>
</template>
