<script setup lang="ts">
import type { BorrowedBook, OwnerLoan } from '~~/shared/types/book'
import type { Ref } from 'vue'

const { t } = useI18n()

type LoansView = 'loaned' | 'borrowed'

usePageTitle(() => t('ui.loans'))

const toast = useToast()
const route = useRoute()
const router = useRouter()
const initialView = route.query.view === 'borrowed' ? 'borrowed' : 'loaned'
const view = ref<LoansView>(initialView)
const returningLoanId = ref<string | null>(null)
const cancellingLoanId = ref<string | null>(null)
const deletingLoanId = ref<string | null>(null)
const loanNoteRequestIds = new Map<string, number>()

watch(
  () => route.query.view,
  (queryView) => {
    const nextView = queryView === 'borrowed' ? 'borrowed' : 'loaned'
    if (view.value !== nextView) {
      view.value = nextView
    }
  }
)

async function setView(nextView: LoansView) {
  if (view.value === nextView) return
  view.value = nextView
  await router.replace({
    query: {
      ...route.query,
      view: nextView
    }
  })
}

const { data: ownerLoans, status: ownerStatus, refresh: refreshOwnerLoans } = await useFetch<OwnerLoan[]>('/api/loans', {
  headers: useRequestHeaders(['cookie']),
  default: () => []
})

const { data: borrowedBooks, status: borrowedStatus } = await useFetch<BorrowedBook[]>('/api/borrowed', {
  headers: useRequestHeaders(['cookie']),
  default: () => []
})

const isPending = computed(() => view.value === 'loaned' ? ownerStatus.value === 'pending' : borrowedStatus.value === 'pending')

interface LoanActionOptions {
  endpoint: string
  requestOptions: { method: 'POST' | 'DELETE' }
  successTitle: string
  failureTitle: string
  fallbackErrorMessage: string
}

async function runLoanAction(loan: OwnerLoan, inFlightLoanId: Ref<string | null>, options: LoanActionOptions) {
  if (inFlightLoanId.value) return

  inFlightLoanId.value = loan.id
  try {
    await $fetch(options.endpoint, options.requestOptions)
    await refreshOwnerLoans()
    toast.add({
      title: options.successTitle,
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : options.fallbackErrorMessage)
    toast.add({
      title: options.failureTitle,
      description: message,
      color: 'error'
    })
  } finally {
    inFlightLoanId.value = null
  }
}

async function returnLoan(loan: OwnerLoan) {
  await runLoanAction(loan, returningLoanId, {
    endpoint: `/api/loans/${loan.id}/return`,
    requestOptions: { method: 'POST' },
    successTitle: t('copy.bookMarkedAsReturned'),
    failureTitle: t('copy.couldNotUpdateLoan'),
    fallbackErrorMessage: t('copy.unableToMarkReturned')
  })
}

async function cancelLoan(loan: OwnerLoan) {
  await runLoanAction(loan, cancellingLoanId, {
    endpoint: `/api/loans/${loan.id}/cancel`,
    requestOptions: { method: 'POST' },
    successTitle: t('copy.loanCanceled'),
    failureTitle: t('copy.couldNotCancelLoan'),
    fallbackErrorMessage: t('copy.unableToCancelLoan')
  })
}

async function deleteLoan(loan: OwnerLoan) {
  await runLoanAction(loan, deletingLoanId, {
    endpoint: `/api/loans/${loan.id}`,
    requestOptions: { method: 'DELETE' },
    successTitle: t('copy.loanRecordDeleted'),
    failureTitle: t('copy.couldNotDeleteLoanRecord'),
    fallbackErrorMessage: t('copy.unableToDeleteLoanRecord')
  })
}

async function saveLoanNote(loan: OwnerLoan, note: string | null) {
  const currentRequestId = (loanNoteRequestIds.get(loan.id) ?? 0) + 1
  loanNoteRequestIds.set(loan.id, currentRequestId)
  const previousNote = loan.note
  loan.note = note
  try {
    await $fetch(`/api/loans/${loan.id}/note`, { method: 'PUT', body: { note } })
    if (currentRequestId === loanNoteRequestIds.get(loan.id)) {
      toast.add({ title: note ? t('copy.loanNoteSaved') : t('copy.loanNoteRemoved'), color: 'success' })
    }
  } catch (err: unknown) {
    if (currentRequestId === loanNoteRequestIds.get(loan.id)) loan.note = previousNote
    const message = (err as { data?: { message?: string } })?.data?.message ?? t('copy.unableToSaveLoanNote')
    toast.add({ title: t('copy.couldNotSaveLoanNote'), description: message, color: 'error' })
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="$t('ui.loans')"
      :description="$t('ui.trackBooksYouLoanedOutAndBooks')"
    >
      <template #links>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-library"
          to="/library"
        >
          {{ $t('ui.myLibrary') }}
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="mb-6">
        <UFieldGroup>
          <UButton
            :color="view === 'loaned' ? 'primary' : 'neutral'"
            :variant="view === 'loaned' ? 'solid' : 'outline'"
            icon="i-lucide-handshake"
            @click="setView('loaned')"
          >
            {{ $t('ui.loanedOut') }}
          </UButton>
          <UButton
            :color="view === 'borrowed' ? 'primary' : 'neutral'"
            :variant="view === 'borrowed' ? 'solid' : 'outline'"
            icon="i-lucide-book-user"
            @click="setView('borrowed')"
          >
            {{ $t('ui.lentToYou') }}
          </UButton>
        </UFieldGroup>
      </div>

      <div
        v-if="isPending"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <LoanedOutLoansSection
        v-else-if="view === 'loaned'"
        :loans="ownerLoans"
        :returning-loan-id="returningLoanId"
        :cancelling-loan-id="cancellingLoanId"
        :deleting-loan-id="deletingLoanId"
        @return-loan="returnLoan"
        @cancel-loan="cancelLoan"
        @delete-loan="deleteLoan"
        @save-loan-note="saveLoanNote"
      />

      <BorrowedLoansSection
        v-else
        :books="borrowedBooks"
      />
    </UPageBody>
  </UContainer>
</template>
