<script setup lang="ts">
const props = defineProps<{
  note: string | null
}>()

const emit = defineEmits<{
  'update:note': [note: string | null]
}>()

const isEditing = ref(false)
const editText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

function startEditing() {
  editText.value = props.note ?? ''
  isEditing.value = true
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

function cancelEditing() {
  isEditing.value = false
  editText.value = ''
}

function saveNote() {
  const trimmed = editText.value.trim()
  emit('update:note', trimmed || null)
  isEditing.value = false
}

function clearNote() {
  emit('update:note', null)
  isEditing.value = false
  editText.value = ''
}

const characterCount = computed(() => editText.value.length)
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3 mb-2">
      <h2 class="text-lg font-semibold">
        {{ $t('ui.yourNote') }}
      </h2>
      <UButton
        v-if="!isEditing"
        color="neutral"
        variant="outline"
        size="sm"
        :icon="note ? 'i-lucide-pencil' : 'i-lucide-plus'"
        @click="startEditing"
      >
        {{ note ? $t('ui.edit') : $t('copy.addNote228') }}
      </UButton>
    </div>

    <!-- Display Mode -->
    <div v-if="!isEditing">
      <p
        v-if="note"
        class="text-muted leading-relaxed whitespace-pre-wrap"
      >
        {{ note }}
      </p>
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ $t('ui.jotDownThoughtsQuotesOrAnythingYou') }}
      </p>
    </div>

    <!-- Edit Mode -->
    <div
      v-else
      class="space-y-3"
    >
      <textarea
        ref="textareaRef"
        v-model="editText"
        rows="5"
        :placeholder="$t('ui.writeYourNoteHere')"
        class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary resize-y min-h-[100px]"
        @keydown.meta.enter="saveNote"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted">
          {{ characterCount }} {{ $t('ui.characters') }}
        </span>
        <div class="flex gap-2">
          <UButton
            v-if="note"
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-trash-2"
            @click="clearNote"
          >
            {{ $t('ui.delete') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            @click="cancelEditing"
          >
            {{ $t('ui.cancel') }}
          </UButton>
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-check"
            @click="saveNote"
          >
            {{ $t('ui.save') }}
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
