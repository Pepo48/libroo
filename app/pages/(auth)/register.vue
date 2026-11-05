<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import type { LegalStatus } from '~~/shared/types/legal'
import type { SignupInvitePreview } from '~~/shared/types/signup-invite'
import { getRegistrationSuccessDescription } from '~~/shared/utils/email-capability-ui'
import { newPasswordSchema } from '~~/shared/utils/password'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { canShowOAuthSignIn, canShowPasswordForm } from '~~/shared/utils/auth-capability-ui'

const { t } = useI18n()

definePageMeta({
  auth: false
})

usePageTitle(() => t('ui.createAccount'))

const route = useRoute()
const config = useRuntimeConfig()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signUp } = authStore
const toast = useToast()
const { data: emailCapabilities, status: emailStatus } = useEmailCapabilities({ lazy: true })
const { data: authCapabilities, status: authStatus } = useAuthCapabilities({ lazy: true })
const { data: legalStatus, error: legalStatusError, status: legalRequestStatus } = useFetch<LegalStatus>('/api/legal/status', { lazy: true })

const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const turnstileToken = ref('')
const turnstile = ref<{ reset: () => void } | null>(null)
const verificationEmail = ref('')
const isVerificationEmailSent = ref(false)
const inviteToken = computed(() => {
  const invite = route.query.invite
  return typeof invite === 'string' && invite.trim() ? invite.trim() : null
})
const registrationEnabled = computed(() => booleanConfigValue(config.public.registrationEnabled, true))
const showPasswordForm = computed(() => canShowPasswordForm(authCapabilities.value))
const showOAuthSignIn = computed(() => canShowOAuthSignIn(authCapabilities.value))
const registrationRequiresInvite = computed(() => !registrationEnabled.value && !inviteToken.value)
const turnstileEnabled = computed(() => booleanConfigValue(config.public.turnstile?.enabled, false))
const turnstileSiteKey = computed(() => typeof config.public.turnstile?.siteKey === 'string' ? config.public.turnstile.siteKey.trim() : '')
const turnstileConfigured = computed(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))
const turnstileMissingConfig = computed(() => turnstileEnabled.value && !turnstileSiteKey.value)
const privacyPolicyUrl = computed(() => configuredLegalUrl(config.public.legalPrivacyPolicyUrl))
const privacyPolicyLink = computed(() => privacyPolicyUrl.value || '/privacy')
const privacyPolicyLinkExternal = computed(() => Boolean(privacyPolicyUrl.value))
const privacyPolicyConfigured = computed(() => Boolean(privacyPolicyUrl.value || legalStatus.value?.privacy))
const termsUrl = computed(() => configuredLegalUrl(config.public.legalTermsUrl))
const termsLink = computed(() => termsUrl.value || '/terms')
const termsLinkExternal = computed(() => Boolean(termsUrl.value))
const termsConfigured = computed(() => Boolean(termsUrl.value || legalStatus.value?.terms))
const termsStatusUnknown = computed(() => !termsUrl.value && Boolean(legalStatusError.value))
const authFormKey = computed(() => `${inviteEmail.value}:${termsConfigured.value}`)

const { data: invitePreview, status: inviteRequestStatus } = useAsyncData<SignupInvitePreview | null>(
  'signup-invite-preview',
  () => inviteToken.value
    ? $fetch<SignupInvitePreview>(`/api/signup-invites/${inviteToken.value}`)
    : Promise.resolve(null),
  {
    lazy: true,
    immediate: Boolean(inviteToken.value),
    default: () => null,
    watch: [inviteToken]
  }
)
const registrationLoading = computed(() => [
  emailStatus.value,
  authStatus.value,
  legalRequestStatus.value,
  ...(inviteToken.value ? [inviteRequestStatus.value] : [])
].some(status => status === 'idle' || status === 'pending'))
const inviteEmail = computed(() => invitePreview.value?.email ?? '')
const inviteStatus = computed(() => invitePreview.value?.status ?? null)
const inviteUnavailable = computed(() =>
  !registrationEnabled.value
  && Boolean(inviteToken.value)
  && inviteStatus.value !== 'pending'
)
const inviteBlockTitle = computed(() => {
  if (registrationRequiresInvite.value) return t('copy.inviteRequired')
  if (inviteStatus.value === 'expired') return t('copy.inviteExpired')
  if (inviteStatus.value === 'revoked') return t('admin.invites.revokedToast')
  if (inviteStatus.value === 'accepted') return t('copy.inviteAlreadyUsed')
  return t('copy.inviteUnavailable')
})
const inviteBlockDescription = computed(() => {
  if (registrationRequiresInvite.value) return t('copy.openTheInviteLinkFromYourAdministratorToCreateAn')
  if (inviteStatus.value === 'expired') return t('copy.thisInviteLinkHasExpiredAskYourAdministratorForA')
  if (inviteStatus.value === 'revoked') return t('copy.thisInviteLinkHasBeenRevokedAskYourAdministratorFor')
  if (inviteStatus.value === 'accepted') return t('copy.thisInviteLinkHasAlreadyBeenUsed')
  return t('copy.thisInviteLinkCannotBeUsedAskYourAdministratorFor')
})

const redirectPath = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && /^\/(?!\/)/.test(redirect)) {
    return redirect
  }
  return '/library'
})

// Redirect if already logged in (but not if we just signed out - race condition with stale state)
const isFromSignout = computed(() => route.query.signout === 'true')

watch(user, (newUser) => {
  // Skip auto-redirect if we just came from sign-out (stale user state may still be present)
  if (isFromSignout.value) return

  if (newUser) {
    navigateTo(redirectPath.value)
  }
}, { immediate: true })

// Form fields
const fields = computed<AuthInputField[]>(() => [
  {
    id: 'register-name',
    name: 'name',
    type: 'text',
    label: t('admin.auditMetadata.name'),
    ariaLabel: t('admin.auditMetadata.name'),
    placeholder: t('copy.enterYourName'),
    required: true
  },
  {
    id: 'register-email',
    name: 'email',
    type: 'email',
    label: t('ui.email'),
    ariaLabel: t('ui.email'),
    placeholder: t('copy.enterYourEmail'),
    defaultValue: inviteEmail.value,
    disabled: Boolean(inviteEmail.value),
    required: true
  },
  {
    id: 'register-password',
    name: 'password',
    type: 'password',
    label: t('ui.password'),
    ariaLabel: 'Password',
    placeholder: t('copy.enterYourPassword'),
    hint: t('copy.atLeast8Characters'),
    required: true
  },
  {
    id: 'register-confirm-password',
    name: 'confirmPassword',
    type: 'password',
    label: t('copy.confirmPassword'),
    ariaLabel: t('copy.confirmPassword'),
    placeholder: t('copy.confirmYourPassword'),
    required: true
  },
  ...(termsConfigured.value
    ? [{
        name: 'acceptTerms',
        type: 'checkbox' as const,
        defaultValue: false,
        required: true
      }]
    : [])
])

// Validation schema
const schema = z.object({
  name: z.string({ error: t('copy.nameIsRequired') }).min(1, { error: t('copy.nameIsRequired') }),
  email: z.email({ error: t('copy.pleaseEnterAValidEmailAddress') }),
  password: newPasswordSchema(),
  confirmPassword: z.string({ error: t('copy.confirmPasswordIsRequired') }).min(1, { error: t('copy.pleaseConfirmYourPassword') }),
  acceptTerms: z.boolean().optional().refine(value => !termsConfigured.value || value === true, {
    error: t('copy.youMustAgreeToTheTermsOfServiceToCreate')
  })
})
  .refine(data => data.password === data.confirmPassword, {
    error: t('copy.passwordsDoNotMatch'),
    path: ['confirmPassword']
  })

type Schema = z.output<typeof schema>

type AuthInputField = AuthFormField & {
  id?: string
  placeholder?: string
  autocomplete?: string
  disabled?: boolean
  ariaLabel?: string
}

function inputFieldProps(field: AuthFormField) {
  const inputField = field as AuthInputField
  return Object.assign({
    id: inputField.id,
    name: inputField.name,
    placeholder: inputField.placeholder,
    autocomplete: inputField.autocomplete,
    required: inputField.required,
    disabled: inputField.disabled
  }, { 'aria-label': inputField.ariaLabel })
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = ''

  if (registrationRequiresInvite.value) {
    error.value = t('copy.anInviteIsRequiredToCreateAnAccount')
    return
  }

  if (inviteUnavailable.value) {
    error.value = inviteBlockDescription.value
    return
  }

  if (inviteEmail.value && payload.data.email.toLowerCase() !== inviteEmail.value) {
    error.value = t('copy.useTheEmailAddressThisInviteWasSentTo')
    return
  }

  if (termsStatusUnknown.value) {
    error.value = t('copy.unableToVerifyTermsOfServiceAvailabilityPleaseTryAgain')
    return
  }

  if (termsConfigured.value && !payload.data.acceptTerms) {
    error.value = t('copy.youMustAgreeToTheTermsOfServiceToCreate')
    return
  }

  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = turnstileMissingConfig.value
      ? t('copy.botProtectionIsEnabledButTheTurnstileSiteKeyIs')
      : t('copy.completeTheBotProtectionCheckBeforeCreatingAnAccount')
    return
  }

  isLoading.value = true

  try {
    const result = await signUp(
      payload.data.email,
      payload.data.password,
      payload.data.name,
      inviteToken.value,
      turnstileToken.value,
      payload.data.acceptTerms
    )

    if (result.error) {
      error.value = result.error.message || t('copy.failedToCreateAccount')
      toast.add({
        title: t('copy.registrationFailed'),
        description: error.value,
        color: 'error'
      })
    } else {
      verificationEmail.value = payload.data.email
      toast.add({
        title: t('copy.accountCreated'),
        description: getRegistrationSuccessDescription(emailCapabilities.value),
        color: 'success'
      })

      if (emailCapabilities.value.emailVerificationEnabled) {
        isVerificationEmailSent.value = true
      }
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('copy.anUnexpectedErrorOccurred')
    toast.add({
      title: t('ui.error'),
      description: error.value,
      color: 'error'
    })
  } finally {
    isLoading.value = false
    if (turnstileEnabled.value) {
      turnstile.value?.reset()
      turnstileToken.value = ''
    }
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <PageDataLoading v-if="registrationLoading && !registrationRequiresInvite && !isVerificationEmailSent" />

    <AuthStateCard
      v-else-if="isVerificationEmailSent"
      :title="$t('ui.verifyYourEmail')"
      icon="i-lucide-mail-check"
      :description="$t('copy.sentVerificationLink', { email: verificationEmail })"
      :action-label="$t('copy.goToSignIn')"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <AuthStateCard
      v-else-if="registrationRequiresInvite || inviteUnavailable"
      :title="inviteBlockTitle"
      :description="inviteBlockDescription"
      icon="i-lucide-lock"
      :action-label="$t('ui.signIn')"
      :action-to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
      action-icon="i-lucide-log-in"
    />

    <AuthStateCard
      v-else-if="!showPasswordForm"
      :title="showOAuthSignIn ? $t('copy.createAnAccountWithSingleSignOn') : $t('ui.signInUnavailable')"
      :description="showOAuthSignIn
        ? $t('copy.localPasswordRegistrationIsDisabledContinueThroughTheConfiguredSign')
        : $t('ui.thisLibrooDeploymentHasNoEnabledSign')"
      :action-label="showOAuthSignIn ? $t('copy.goToSignIn') : undefined"
      :action-to="showOAuthSignIn ? { path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined } : undefined"
      icon="i-lucide-lock-keyhole"
      :action-icon="showOAuthSignIn ? 'i-lucide-log-in' : undefined"
    />

    <UPageCard v-else>
      <UAuthForm
        :key="authFormKey"
        novalidate
        :schema="schema"
        :fields="fields"
        :loading="isLoading"
        :title="$t('ui.createAccount')"
        icon="i-lucide-user-plus"
        submit-label="Create Account"
        @submit="onSubmit"
      >
        <template #description>
          {{ $t('ui.alreadyHaveAnAccount') }}
          <ULink
            :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
            class="text-primary font-medium"
          >
            {{ $t('ui.signIn') }}
          </ULink>
        </template>

        <template #password-field="{ state, field }">
          <UInput
            v-model="state.password"
            v-bind="inputFieldProps(field)"
            :type="showPassword ? 'text' : 'password'"
            class="w-full"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? $t('copy.hidePassword') : $t('copy.showPassword')"
                :aria-pressed="showPassword"
                @click="() => { showPassword = !showPassword }"
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
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="link"
                size="sm"
                :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showConfirmPassword ? $t('copy.hideConfirmedPassword') : $t('copy.showConfirmedPassword')"
                :aria-pressed="showConfirmPassword"
                @click="() => { showConfirmPassword = !showConfirmPassword }"
              />
            </template>
          </UInput>
        </template>

        <template #acceptTerms-field="{ state, field }">
          <UCheckbox
            v-model="state.acceptTerms"
            v-bind="inputFieldProps(field)"
          >
            <template #label>
              {{ $t('ui.iAgreeToThe') }}
              <ULink
                :to="termsLink"
                :target="termsLinkExternal ? '_blank' : undefined"
                :rel="termsLinkExternal ? 'noopener noreferrer' : undefined"
                class="text-primary font-medium"
                @click.stop
              >
                {{ $t('ui.termsOfService') }}
              </ULink>
            </template>
          </UCheckbox>
        </template>

        <template
          #validation
        >
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

          <p
            v-if="privacyPolicyConfigured"
            class="text-center text-sm text-muted"
          >
            {{ $t('ui.byCreatingAnAccountYouAcknowledgeThat') }}
            <ULink
              :to="privacyPolicyLink"
              :target="privacyPolicyLinkExternal ? '_blank' : undefined"
              :rel="privacyPolicyLinkExternal ? 'noopener noreferrer' : undefined"
              class="text-primary font-medium"
            >
              {{ $t('ui.privacyPolicy') }}
            </ULink>.
          </p>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            :title="error"
          />
        </template>
      </UAuthForm>
    </UPageCard>
  </UContainer>
</template>
