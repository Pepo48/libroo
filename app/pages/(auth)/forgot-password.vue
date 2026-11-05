<script setup lang="ts">
import * as z from 'zod'
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const { t } = useI18n()

definePageMeta({
  auth: false
})

usePageTitle(() => t('ui.resetPasswordText'))

const toast = useToast()
const config = useRuntimeConfig()
const { data: emailCapabilities } = await useEmailCapabilities()
const isSubmitting = ref(false)
const requestSent = ref(false)
const turnstileToken = ref('')
const turnstile = ref<{ reset: () => void } | null>(null)
const turnstileEnabled = computed(() => booleanConfigValue(config.public.turnstile?.enabled, false))
const turnstileSiteKey = computed(() => typeof config.public.turnstile?.siteKey === 'string' ? config.public.turnstile.siteKey.trim() : '')
const turnstileConfigured = computed(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))
const turnstileMissingConfig = computed(() => turnstileEnabled.value && !turnstileSiteKey.value)

const fields: AuthFormField[] = [
  {
    name: 'email',
    type: 'email',
    label: t('ui.email'),
    placeholder: t('copy.enterYourEmail'),
    required: true
  }
]

const schema = z.object({
  email: z.email({ error: t('copy.pleaseEnterAValidEmailAddress') })
})

type Schema = z.output<typeof schema>

function getFailureMessage(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, message?: string })?.data?.message
    || (err as { message?: string })?.message
    || fallback
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  if (!emailCapabilities.value.passwordResetEnabled || isSubmitting.value) return

  if (turnstileEnabled.value && !turnstileToken.value) {
    toast.add({
      title: t('copy.resetUnavailable'),
      description: turnstileMissingConfig.value
        ? t('copy.botProtectionIsEnabledButTheTurnstileSiteKeyIs')
        : t('copy.completeTheBotProtectionCheckBeforeRequestingAResetEmail'),
      color: 'error'
    })
    return
  }

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: turnstileToken.value
        ? {
            'x-captcha-response': turnstileToken.value
          }
        : undefined,
      body: {
        email: payload.data.email,
        redirectTo: '/reset-password'
      }
    })
    requestSent.value = true
    toast.add({
      title: t('ui.resetEmailSent'),
      description: t('ui.ifThisEmailExistsInLibrooA'),
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: t('copy.resetUnavailable'),
      description: getFailureMessage(err, t('copy.unableToSendAPasswordResetEmail')),
      color: 'error'
    })
  } finally {
    isSubmitting.value = false
    if (turnstileEnabled.value) {
      turnstile.value?.reset()
      turnstileToken.value = ''
    }
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      v-if="!emailCapabilities.passwordResetEnabled"
      :title="$t('ui.resetPassword')"
      :description="$t('ui.passwordResetEmailIsUnavailableContactYour')"
      icon="i-lucide-mail-x"
      :action-label="$t('copy.backToSignIn')"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <AuthStateCard
      v-else-if="requestSent"
      :title="$t('ui.resetEmailSent')"
      :description="$t('ui.ifThisEmailExistsInLibrooA')"
      icon="i-lucide-send"
      :action-label="$t('copy.backToSignIn')"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <UPageCard v-else>
      <UAuthForm
        novalidate
        :schema="schema"
        :fields="fields"
        :loading="isSubmitting"
        :title="$t('ui.resetPassword')"
        icon="i-lucide-key-round"
        submit-label="Send reset email"
        @submit="onSubmit"
      >
        <template #description>
          {{ $t('ui.rememberYourPassword') }}
          <ULink
            to="/login"
            class="text-primary font-medium"
          >
            {{ $t('ui.signIn') }}
          </ULink>
        </template>

        <template #validation>
          <div
            v-if="turnstileConfigured"
            class="flex justify-center"
          >
            <NuxtTurnstile
              ref="turnstile"
              v-model="turnstileToken"
              :site-key="turnstileSiteKey"
              :options="{ size: 'normal' }"
            />
          </div>

          <UAlert
            v-if="turnstileMissingConfig"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            :title="$t('ui.botProtectionIsNotConfigured')"
          />
        </template>

        <template #footer>
          <p class="text-center text-sm text-muted">
            {{ $t('ui.librooYourLibraryManaged') }}
          </p>
        </template>
      </UAuthForm>
    </UPageCard>
  </UContainer>
</template>
