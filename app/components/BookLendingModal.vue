<script setup lang="ts">
interface Props {
  open: boolean
  userBookId: string
  saving?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': [loan: OwnerLoan]
}>()

const toast = useToast()
const { t } = useI18n()
const { data: emailCapabilities } = await useEmailCapabilities()

const borrowerDisplayName = ref('')
const borrowerEmail = ref('')
const borrowerSuggestions = ref<BorrowerSuggestion[]>([])
const suggestionsLoading = ref(false)
const dueAt = ref('')
const note = ref('')
const isSaving = ref(false)
const inviteUrl = ref('')
const copiedAutomatically = ref(false)
const loanId = ref('')
const deliveryStatus = ref<LoanInviteDeliveryStatus | null>(null)
const isResending = ref(false)
let suggestionTimer: ReturnType<typeof setTimeout> | undefined
let suggestionRequestId = 0
let skipNextSuggestionLookup = false
const canEmailInvite = computed(() => Boolean(emailCapabilities.value?.inviteEmailEnabled && borrowerEmail.value.trim()))

const borrowerSuggestionItems = computed(() => borrowerSuggestions.value.map(suggestion => ({
  label: suggestion.displayName,
  description: suggestion.email ?? t('lending.noEmail'),
  email: suggestion.email,
  onSelect: () => selectBorrowerSuggestion(suggestion)
})))

const tomorrowDate = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
})

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const isSaved = computed(() => Boolean(inviteUrl.value))
const canSave = computed(() => borrowerDisplayName.value.trim().length > 0 && !isSaving.value && !isSaved.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    borrowerDisplayName.value = ''
    borrowerEmail.value = ''
    resetBorrowerSuggestions()
    dueAt.value = ''
    note.value = ''
    inviteUrl.value = ''
    copiedAutomatically.value = false
    loanId.value = ''
    deliveryStatus.value = null
  }
)

watch(borrowerDisplayName, (query) => {
  if (skipNextSuggestionLookup) {
    skipNextSuggestionLookup = false
    return
  }
  if (suggestionTimer) clearTimeout(suggestionTimer)
  borrowerSuggestions.value = []
  const trimmedQuery = query.trim()
  if (!props.open || isSaved.value || trimmedQuery.length < 2) {
    suggestionRequestId++
    suggestionsLoading.value = false
    return
  }

  const requestId = ++suggestionRequestId
  suggestionTimer = setTimeout(async () => {
    suggestionsLoading.value = true
    try {
      const suggestions = await $fetch<BorrowerSuggestion[]>('/api/loans/borrower-suggestions', {
        query: { query: trimmedQuery }
      })
      if (requestId === suggestionRequestId) borrowerSuggestions.value = suggestions
    } catch {
      if (requestId === suggestionRequestId) borrowerSuggestions.value = []
    } finally {
      if (requestId === suggestionRequestId) suggestionsLoading.value = false
    }
  }, 250)
})

onBeforeUnmount(resetBorrowerSuggestions)

function resetBorrowerSuggestions() {
  if (suggestionTimer) clearTimeout(suggestionTimer)
  suggestionTimer = undefined
  suggestionRequestId++
  borrowerSuggestions.value = []
  suggestionsLoading.value = false
}

function selectBorrowerSuggestion(suggestion: BorrowerSuggestion) {
  skipNextSuggestionLookup = true
  borrowerDisplayName.value = suggestion.displayName
  void nextTick(() => {
    skipNextSuggestionLookup = false
  })
  borrowerEmail.value = suggestion.email ?? ''
  resetBorrowerSuggestions()
}

async function lendBook() {
  if (!canSave.value) return

  isSaving.value = true
  try {
    const result = await $fetch<{ loan: OwnerLoan, inviteUrl: string, deliveryStatus: LoanInviteDeliveryStatus }>(`/api/books/${props.userBookId}/loans`, {
      method: 'POST',
      body: {
        borrowerDisplayName: borrowerDisplayName.value,
        borrowerEmail: borrowerEmail.value || null,
        dueAt: dueAt.value || null,
        note: note.value || null
      }
    })

    inviteUrl.value = `${window.location.origin}${result.inviteUrl}`
    loanId.value = result.loan.id
    deliveryStatus.value = result.deliveryStatus
    copiedAutomatically.value = await copyInvite({ showToast: false })
    emit('saved', { ...result.loan, inviteUrl: result.inviteUrl })
    toast.add({
      title: t('lending.saved'),
      description: result.deliveryStatus === 'sent'
        ? t('lending.sentWithLink')
        : result.deliveryStatus === 'failed'
          ? t('lending.failedWithLink')
          : copiedAutomatically.value ? t('lending.copied') : t('lending.linkReady'),
      color: result.deliveryStatus === 'failed' ? 'warning' : 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : t('lending.saveFailed'))
    toast.add({
      title: t('lending.saveFailed'),
      description: message,
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

async function resendEmail() {
  const token = inviteUrl.value ? new URL(inviteUrl.value).pathname.split('/').pop() : null
  if (!loanId.value || !token) return
  isResending.value = true
  try {
    const result = await $fetch<{ deliveryStatus: LoanInviteDeliveryStatus }>(`/api/loans/${loanId.value}/invite-email`, { method: 'POST', body: { token } })
    deliveryStatus.value = result.deliveryStatus
    toast.add({ title: result.deliveryStatus === 'sent' ? t('lending.sent') : t('lending.emailUnavailable'), color: result.deliveryStatus === 'sent' ? 'success' : 'warning' })
  } catch {
    toast.add({ title: t('lending.resendFailed'), description: t('lending.linkReady'), color: 'error' })
  } finally {
    isResending.value = false
  }
}

async function copyInvite(options: { showToast?: boolean } = {}) {
  if (!inviteUrl.value) return false

  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    if (options.showToast !== false) {
      toast.add({
        title: t('admin.invites.copied'),
        color: 'success'
      })
    }
    return true
  } catch {
    if (options.showToast !== false) {
      toast.add({
        title: t('admin.invites.copyFailed'),
        description: t('lending.linkReady'),
        color: 'warning'
      })
    }
    return false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    :title="$t('ui.recordABookLoan')"
    :description="$t('ui.saveWhoHasThisBook')"
    :ui="{ content: 'sm:max-w-xl', footer: 'justify-end gap-2' }"
  >
    <template #body>
      <div
        class="space-y-4"
        @keydown.meta.enter.prevent="lendBook"
      >
        <UAlert
          v-if="!isSaved"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          :title="$t('ui.aShareLinkWillBeCreated')"
          :description="canEmailInvite ? $t('lending.shareByEmail') : $t('lending.shareByLink')"
        />

        <UFormField
          :label="$t('ui.borrowerName')"
          required
        >
          <UInputMenu
            v-model="borrowerDisplayName"
            mode="autocomplete"
            :items="borrowerSuggestionItems"
            value-key="label"
            ignore-filter
            :loading="suggestionsLoading"
            :placeholder="$t('ui.whoHasTheBook')"
            icon="i-lucide-user"
            class="w-full"
            :disabled="isSaved"
          >
            <template #empty>
              <span v-if="!suggestionsLoading && borrowerDisplayName.trim().length >= 2">
                {{ $t('ui.noPreviousBorrowersFound') }}
              </span>
            </template>
          </UInputMenu>
        </UFormField>

        <UFormField
          :label="canEmailInvite ? $t('lending.inviteEmail') : $t('lending.optionalEmail')"
          :help="canEmailInvite ? $t('lending.inviteEmailHelp') : $t('lending.optionalEmailHelp')"
        >
          <UInput
            v-model="borrowerEmail"
            type="email"
            :placeholder="$t('ui.optional')"
            icon="i-lucide-mail"
            class="w-full"
            :disabled="isSaved"
          />
        </UFormField>

        <UFormField :label="$t('ui.dueDate')">
          <UInput
            v-model="dueAt"
            type="date"
            icon="i-lucide-calendar"
            :min="tomorrowDate"
            class="w-full"
            :disabled="isSaved"
          />
        </UFormField>

        <UFormField
          :label="$t('ui.privateNote')"
          :help="$t('ui.onlyYouCanSeeThisNote')"
        >
          <UTextarea
            v-model="note"
            :placeholder="$t('ui.optional')"
            :disabled="isSaved"
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="inviteUrl"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          :title="$t('ui.shareLinkCopied')"
        >
          <template #description>
            <div class="min-w-0 space-y-1">
              <p>{{ $t('ui.inviteUrl') }}</p>
              <button
                type="button"
                class="block w-full min-w-0 text-left"
                @click="() => { void copyInvite() }"
              >
                <code
                  data-testid="loan-invite-url"
                  class="block break-all text-xs leading-relaxed"
                >{{ inviteUrl }}</code>
              </button>
            </div>
          </template>
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              @click="() => { void copyInvite() }"
            >
              {{ $t('ui.copyLink') }}
            </UButton>
            <UButton
              v-if="deliveryStatus === 'failed'"
              color="warning"
              variant="outline"
              icon="i-lucide-send"
              :loading="isResending"
              @click="() => { void resendEmail() }"
            >
              {{ $t('ui.resendEmail') }}
            </UButton>
          </template>
        </UAlert>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="() => { modalOpen = false }"
      >
        {{ $t('ui.close') }}
      </UButton>
      <UButton
        v-if="!isSaved"
        icon="i-lucide-handshake"
        :loading="isSaving"
        :disabled="!canSave"
        @click="lendBook"
      >
        {{ $t('ui.saveLoan') }}
      </UButton>
    </template>
  </UModal>
</template>
