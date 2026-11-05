<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { storeToRefs } from 'pinia'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const { t } = useI18n()

const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signOut } = authStore
const route = useRoute()
const config = useRuntimeConfig()
const registrationEnabled = computed(() => booleanConfigValue(config.public.registrationEnabled, true))

async function handleSignOut() {
  try {
    await signOut()
  } catch (error) {
    console.error(t('copy.failedToSignOut'), error)
  } finally {
    // Pass signout param so login page skips auto-redirect (race condition with stale user state)
    navigateTo('/login?signout=true')
  }
}

// Logo destination based on auth status
const logoTo = computed(() => user.value ? '/library' : '/login')

const adminLinks = computed<NavigationMenuItem[]>(() => [
  {
    label: t('ui.users'),
    icon: 'i-lucide-users',
    to: '/admin/users'
  },
  ...(!registrationEnabled.value
    ? [{
        label: t('ui.invites'),
        icon: 'i-lucide-user-plus',
        to: '/admin/invites'
      }]
    : []),
  {
    label: t('ui.audit'),
    icon: 'i-lucide-scroll-text',
    to: '/admin/audit'
  },
  {
    label: t('ui.metrics'),
    icon: 'i-lucide-bar-chart-3',
    to: '/admin/metrics'
  }
])

// Navigation links - only show Sign Out when logged in
const links = computed<NavigationMenuItem[]>(() => {
  if (user.value) {
    const authenticatedLinks: NavigationMenuItem[] = [
      {
        label: t('ui.library'),
        icon: 'i-lucide-library',
        to: '/library'
      },
      {
        label: t('ui.loans'),
        icon: 'i-lucide-handshake',
        to: '/library/loans'
      },
      {
        label: t('ui.locations'),
        icon: 'i-lucide-map',
        to: '/library/locations'
      },
      {
        label: t('ui.settings'),
        icon: 'i-lucide-settings',
        to: '/settings'
      },
      {
        label: t('ui.signOut'),
        icon: 'i-lucide-log-out',
        color: 'neutral' as const,
        variant: 'ghost' as const,
        onClick: handleSignOut
      }
    ]

    if (roleIncludesAdmin(user.value.role)) {
      authenticatedLinks.splice(3, 0, {
        label: t('ui.admin'),
        icon: 'i-lucide-shield',
        to: '/admin/users',
        active: route.path.startsWith('/admin'),
        children: adminLinks.value
      })
    }

    return authenticatedLinks
  }
  return []
})
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink
        :to="logoTo"
        class="flex items-center gap-2"
      >
        <NuxtImg
          src="/Libroo_Icon.svg"
          alt=""
          aria-hidden="true"
          width="28"
          height="28"
          class="size-7 shrink-0"
        />
        <span class="font-bold text-xl">Libroo</span>
      </NuxtLink>
    </template>

    <template #right>
      <UNavigationMenu
        :items="links"
        class="hidden lg:flex"
        variant="link"
      />

      <CustomColorModeButton />
    </template>

    <template #body>
      <UNavigationMenu
        :items="links"
        orientation="vertical"
        class="-mx-2"
      />
    </template>
  </UHeader>
</template>
