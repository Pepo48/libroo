<script setup lang="ts">
import * as z from 'zod'
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { newPasswordSchema } from '~~/shared/utils/password'

const { t } = useI18n()

definePageMeta({
  auth: false
})

usePageTitle(() => t('ui.setNewPasswordText'))

const route = useRoute()
const toast = useToast()
const token = computed(() => {
  const value = route.query.token
  return typeof value === 'string' && value.trim() ? value.trim() : ''
})
const isSubmitting = ref(false)
const isComplete = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

const fields: AuthFormField[] = [
  {
    name: 'newPassword',
    type: 'password',
    label: t('ui.newPassword'),
    placeholder: t('copy.enterYourNewPassword'),
    required: true
  },
  {
    name: 'confirmPassword',
    type: 'password',
    label: t('ui.confirmNewPassword'),
    placeholder: t('copy.confirmYourNewPassword'),
    required: true
  }
]

const schema = z.object({
  newPassword: newPasswordSchema(),
  confirmPassword: z.string({ error: t('copy.confirmPasswordIsRequired') }).min(1, { error: t('copy.pleaseConfirmYourPassword') })
}).refine(data => data.newPassword === data.confirmPassword, {
  error: t('copy.passwordsDoNotMatch'),
  path: ['confirmPassword']
})

type Schema = z.output<typeof schema>

type AuthInputField = AuthFormField & {
  placeholder?: string
  autocomplete?: string
  required?: boolean
}

function inputFieldProps(field: AuthFormField) {
  const inputField = field as AuthInputField
  return {
    name: inputField.name,
    placeholder: inputField.placeholder,
    autocomplete: inputField.autocomplete,
    required: inputField.required
  }
}

function getFailureMessage(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, message?: string })?.data?.message
    || (err as { message?: string })?.message
    || fallback
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  if (!token.value || isSubmitting.value) return

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: token.value,
        newPassword: payload.data.newPassword
      }
    })
    isComplete.value = true
    toast.add({
      title: t('ui.passwordUpdated'),
      description: t('ui.signInWithYourNewPassword'),
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: t('copy.passwordResetFailed'),
      description: getFailureMessage(err, t('copy.thisResetLinkIsInvalidOrExpired')),
      color: 'error'
    })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      v-if="!token"
      :title="$t('ui.setNewPassword')"
      :description="$t('ui.openThePasswordResetLinkFromYour')"
      icon="i-lucide-circle-alert"
      :action-label="$t('copy.requestAResetLink')"
      action-to="/forgot-password"
      action-icon="i-lucide-send"
    />

    <AuthStateCard
      v-else-if="isComplete"
      :title="$t('ui.passwordUpdated')"
      :description="$t('ui.signInWithYourNewPassword')"
      icon="i-lucide-check"
      :action-label="$t('copy.goToSignIn')"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <UPageCard v-else>
      <UAuthForm
        novalidate
        :schema="schema"
        :fields="fields"
        :loading="isSubmitting"
        :title="$t('ui.setNewPassword')"
        icon="i-lucide-key-round"
        submit-label="Update password"
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

        <template #newPassword-field="{ state, field }">
          <UInput
            v-model="state.newPassword"
            v-bind="inputFieldProps(field)"
            :type="showNewPassword ? 'text' : 'password'"
            class="w-full"
            autocomplete="new-password"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showNewPassword ? $t('copy.hideNewPassword') : $t('copy.showNewPassword')"
                @click="() => { showNewPassword = !showNewPassword }"
              />
            </template>
          </UInput>
        </template>

        <template #confirmPassword-field="{ state, field }">
          <UInput
            v-model="state.confirmPassword"
            v-bind="inputFieldProps(field)"
            :type="showConfirmPassword ? 'text' : 'password'"
            class="w-full"
            autocomplete="new-password"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showConfirmPassword ? $t('copy.hideConfirmedPassword') : $t('copy.showConfirmedPassword')"
                @click="() => { showConfirmPassword = !showConfirmPassword }"
              />
            </template>
          </UInput>
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
