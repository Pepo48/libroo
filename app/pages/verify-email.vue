<script setup lang="ts">
import { getEmailVerificationFailureStatus } from '~~/shared/utils/email-verification'

const { t } = useI18n()

definePageMeta({
  auth: false
})

usePageTitle(() => t('ui.emailVerificationText'))

const route = useRoute()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
const status = ref<'pending' | 'success' | 'expired' | 'invalid' | 'failure'>('pending')
const message = computed(() => {
  switch (status.value) {
    case 'success':
      return t('copy.yourEmailAddressHasBeenVerified')
    case 'expired':
      return t('copy.thisVerificationLinkHasExpiredRequestANewEmailFrom')
    case 'invalid':
      return t('copy.thisVerificationLinkIsInvalidOrHasAlreadyBeenUsed')
    case 'failure':
      return t('copy.unableToVerifyThisEmailAddressRequestANewEmail')
    default:
      return t('copy.checkingYourVerificationLink')
  }
})

const icon = computed(() => {
  switch (status.value) {
    case 'success':
      return 'i-lucide-shield-check'
    case 'pending':
      return 'i-lucide-loader-circle'
    default:
      return 'i-lucide-triangle-alert'
  }
})

const actionLabel = computed(() => {
  if (status.value === 'pending') return ''
  if (status.value === 'success') {
    return isAuthenticated.value ? t('copy.goToYourLibrary') : t('copy.goToSignIn')
  }
  return t('copy.openSettings')
})
const actionTo = computed(() => {
  if (status.value === 'pending') return undefined
  if (status.value === 'success') {
    return isAuthenticated.value ? '/library' : '/login'
  }
  return '/settings'
})
const actionIcon = computed(() => {
  if (status.value === 'pending') return undefined
  if (status.value === 'success') {
    return isAuthenticated.value ? 'i-lucide-library' : 'i-lucide-log-in'
  }
  return 'i-lucide-settings'
})

onMounted(async () => {
  const token = route.query.token
  const error = route.query.error

  if (error === 'TOKEN_EXPIRED') {
    status.value = 'expired'
    return
  }

  if (error) {
    status.value = 'invalid'
    return
  }

  if (typeof token !== 'string' || !token) {
    status.value = 'invalid'
    return
  }

  try {
    const result = await $fetch<{ status: boolean }>('/api/auth/verify-email', {
      query: { token },
      method: 'GET'
    })
    if (result.status !== true) {
      status.value = 'invalid'
      return
    }

    try {
      await authStore.refresh()
    } catch {
      // Verification already succeeded; fall back to the current auth state.
    }
    status.value = 'success'
  } catch (err: unknown) {
    status.value = getEmailVerificationFailureStatus(err)
  }
})
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      :title="$t('ui.emailVerification')"
      :description="message"
      :icon="icon"
      :action-label="actionLabel"
      :action-to="actionTo"
      :action-icon="actionIcon"
    />
  </UContainer>
</template>
