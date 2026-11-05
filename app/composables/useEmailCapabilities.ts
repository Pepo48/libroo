import type { EmailCapabilities } from '~~/shared/types/email-capabilities'

const defaultEmailCapabilities = (): EmailCapabilities => ({
  emailSendingEnabled: false,
  emailVerificationEnabled: false,
  passwordResetEnabled: false,
  inviteEmailEnabled: false,
  emailChangeVerificationEnabled: false,
  reminderEmailEnabled: false
})

export function useEmailCapabilities({ lazy = false } = {}) {
  return useAsyncData<EmailCapabilities>(
    'email-capabilities',
    () => $fetch<EmailCapabilities>('/api/capabilities/email'),
    { default: defaultEmailCapabilities, lazy }
  )
}
