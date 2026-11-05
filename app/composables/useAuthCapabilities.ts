import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'

const defaultAuthCapabilities = (): AuthCapabilities => ({
  twoFactorEnabled: false,
  passkeysEnabled: false,
  emailPasswordEnabled: true,
  oauthProvider: null
})

export function useAuthCapabilities({ lazy = false } = {}) {
  return useAsyncData<AuthCapabilities>(
    'auth-capabilities',
    () => $fetch<AuthCapabilities>('/api/capabilities/auth'),
    { default: defaultAuthCapabilities, lazy }
  )
}
