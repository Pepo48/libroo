<script setup lang="ts">
import type { BorrowedBook, InvitePreview } from '~~/shared/types/book'

const { t } = useI18n()

definePageMeta({
  auth: false
})

const route = useRoute()
const toast = useToast()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

const token = route.params.token as string
const isAccepting = ref(false)

const { data: invite, status } = await useFetch<InvitePreview | null>(`/api/invite/${token}`, {
  default: () => null
})

usePageTitle(computed(() => invite.value?.title ? `Invitation: ${invite.value.title}` : t('copy.bookInvitation')))

const coverUrl = computed(() => invite.value?.coverPath ? `/api/invite/${token}/cover` : null)
const redirectPath = computed(() => `/i/${token}`)
const isSignedIn = computed(() => Boolean(user.value))

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

async function acceptBook() {
  if (!isSignedIn.value || !invite.value?.canAccept || isAccepting.value) return

  isAccepting.value = true
  try {
    await $fetch<BorrowedBook>(`/api/invite/${token}/accept`, {
      method: 'POST',
      credentials: 'same-origin'
    })
    toast.add({
      title: t('copy.addedToBorrowedBooks'),
      color: 'success'
    })
    await navigateTo({ path: '/library/loans', query: { view: 'borrowed' } })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : t('copy.thisInvitationIsNoLongerAvailable'))
    toast.add({
      title: t('copy.couldNotAddBook'),
      description: message,
      color: 'error'
    })
  } finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <UContainer class="py-10 max-w-3xl">
    <div
      v-if="status === 'pending'"
      class="flex justify-center py-12"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-4xl text-muted"
      />
    </div>

    <UCard
      v-else-if="!invite"
      class="text-center py-12"
    >
      <UIcon
        name="i-lucide-link-2-off"
        class="text-6xl text-muted mx-auto mb-4"
      />
      <h1 class="text-2xl font-bold mb-2">
        {{ $t('ui.invitationUnavailable') }}
      </h1>
      <p class="text-muted">
        {{ $t('ui.thisInviteMayHaveAlreadyBeenUsed') }}
      </p>
    </UCard>

    <div
      v-else
      class="grid gap-8 md:grid-cols-[220px_1fr] md:items-start"
    >
      <div class="mx-auto w-44 md:w-full">
        <div class="rounded-lg overflow-hidden shadow-lg">
          <NuxtImg
            v-if="coverUrl"
            :src="coverUrl"
            :alt="invite.title"
            class="w-full object-cover"
          />
          <div
            v-else
            class="aspect-[2/3] bg-muted flex items-center justify-center"
          >
            <UIcon
              name="i-lucide-book"
              class="text-6xl text-muted"
            />
          </div>
        </div>
      </div>

      <div class="space-y-5 text-center md:text-left">
        <UBadge
          color="primary"
          variant="subtle"
          size="lg"
        >
          {{ $t('ui.thisBookWasLentToYou') }}
        </UBadge>
        <div>
          <h1 class="text-3xl font-bold tracking-tight">
            {{ invite.title }}
          </h1>
          <p class="mt-2 text-lg text-muted">
            {{ invite.author }}
          </p>
          <p class="mt-4 text-muted">
            {{ $t('copy.sharedBy', { name: invite.ownerName }) }}
          </p>
          <p
            v-if="invite.dueAt"
            class="mt-2 text-sm text-muted"
          >
            {{ $t('ui.due') }} {{ formatDate(invite.dueAt) }}
          </p>
        </div>

        <UAlert
          v-if="invite.isOwnInvite"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="$t('ui.thisIsYourInvite')"
          :description="$t('ui.youCreatedThisLendingInviteSoIt')"
        />

        <UAlert
          v-else-if="!invite.canAccept"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="$t('ui.thisInviteIsNoLongerAvailable')"
          :description="$t('ui.itMayHaveAlreadyBeenAcceptedReturned')"
        />

        <div class="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
          <template v-if="invite.canAccept && isSignedIn">
            <UButton
              size="lg"
              icon="i-lucide-book-plus"
              :loading="isAccepting"
              :disabled="isAccepting"
              @click="acceptBook"
            >
              {{ $t('ui.addToBorrowedBooks') }}
            </UButton>
          </template>
          <template v-else-if="invite.canAccept">
            <UButton
              size="lg"
              icon="i-lucide-log-in"
              :to="{ path: '/login', query: { redirect: redirectPath } }"
            >
              {{ $t('ui.signIn') }}
            </UButton>
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-user-plus"
              :to="{ path: '/register', query: { redirect: redirectPath } }"
            >
              {{ $t('ui.createAccountText') }}
            </UButton>
          </template>
          <UButton
            v-else
            color="neutral"
            variant="outline"
            icon="i-lucide-library"
            to="/library"
          >
            {{ $t('ui.goToLibrary') }}
          </UButton>
        </div>
      </div>
    </div>
  </UContainer>
</template>
