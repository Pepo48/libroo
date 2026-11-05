<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui/components/Table.vue'
import type { AdminUser, AdminUsersPage } from '~~/shared/types/admin'
import { formatAdminDateTime } from '~/utils/admin-date-format'

const { t, locale } = useI18n()

usePageTitle(() => t('ui.adminUsers'))

const toast = useToast()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { user: currentUser } = storeToRefs(authStore)
const roleUpdatingUserIds = ref(new Set<string>())
const statusUpdatingUserIds = ref(new Set<string>())
const adminAuth = useAuth()
const requestFetch = useRequestFetch()
const pageSize = 25

const currentPage = computed({
  get: () => parsePage(route.query.page),
  set: (page: number) => {
    router.push({
      query: pageQuery(page)
    })
  }
})

const { data: usersPage, status, error } = await useAsyncData<AdminUsersPage>(
  'admin-users',
  () => loadUsers(currentPage.value),
  {
    default: () => emptyUsersPage(currentPage.value),
    watch: [currentPage]
  }
)

const users = computed(() => usersPage.value.users)
const totalUsers = computed(() => usersPage.value.total)
const totalPages = computed(() => Math.max(1, Math.ceil(totalUsers.value / pageSize)))
const pageStart = computed(() => totalUsers.value === 0 ? 0 : ((currentPage.value - 1) * pageSize) + 1)
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalUsers.value))
const isLoadingUsers = computed(() => ['idle', 'pending'].includes(status.value))
const isInvalidPage = computed(() => !isLoadingUsers.value && currentPage.value > totalPages.value)
const isInitialLoading = computed(() => (isLoadingUsers.value || isInvalidPage.value) && users.value.length === 0)

if (isInvalidPage.value) {
  await navigateTo({ path: route.path, query: pageQuery(totalPages.value) }, { replace: true })
}

watch(isInvalidPage, (invalid) => {
  if (invalid) {
    router.replace({ query: pageQuery(totalPages.value) })
  }
})

const columns = computed<TableColumn<AdminUser>[]>(() => [
  { accessorKey: 'name', header: t('admin.columns.name') },
  { accessorKey: 'email', header: t('ui.email') },
  { accessorKey: 'createdAt', header: t('admin.columns.created') },
  { accessorKey: 'lastSessionActivityAt', header: t('ui.lastSessionUpdate') },
  { accessorKey: 'role', header: t('admin.columns.role') },
  { accessorKey: 'status', header: t('ui.status') },
  { id: 'actions', header: t('admin.columns.actions') }
])

function roleColor(role: AdminUser['role']) {
  return role === 'admin' ? 'primary' : 'neutral'
}

function statusColor(accountStatus: AdminUser['status']) {
  return accountStatus === 'active' ? 'success' : 'error'
}

function canDemote(user: AdminUser) {
  return user.isAdmin && user.id !== currentUser.value?.id
}

function canBan(user: AdminUser) {
  return user.status === 'active' && user.id !== currentUser.value?.id
}

function originalUser(row: TableRow<AdminUser>) {
  return row.original
}

async function setRole(user: AdminUser, role: AdminUser['role']) {
  if (roleUpdatingUserIds.value.has(user.id)) return

  roleUpdatingUserIds.value.add(user.id)
  try {
    await unwrapAuthResponse(adminAuth.admin.setRole({
      userId: user.id,
      role
    }))
    usersPage.value = {
      ...usersPage.value,
      users: users.value.map(item =>
        item.id === user.id
          ? {
              ...item,
              role,
              isAdmin: role === 'admin'
            }
          : item
      )
    }
    toast.add({
      title: role === 'admin' ? t('admin.users.promoted') : t('admin.users.demoted'),
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : t('admin.users.roleFailed'))
    toast.add({
      title: t('admin.users.roleFailed'),
      description: message,
      color: 'error'
    })
  } finally {
    roleUpdatingUserIds.value.delete(user.id)
  }
}

async function banUser(user: AdminUser) {
  if (statusUpdatingUserIds.value.has(user.id)) return

  statusUpdatingUserIds.value.add(user.id)
  try {
    const response = await unwrapAuthResponse(adminAuth.admin.banUser({
      userId: user.id,
      banReason: 'Account disabled by an administrator'
    }))
    updateUserStatus(user.id, response.user)
    toast.add({
      title: t('admin.users.accountBanned'),
      color: 'success'
    })
  } catch (err: unknown) {
    showStatusError(err, t('admin.users.banFailed'))
  } finally {
    statusUpdatingUserIds.value.delete(user.id)
  }
}

async function unbanUser(user: AdminUser) {
  if (statusUpdatingUserIds.value.has(user.id)) return

  statusUpdatingUserIds.value.add(user.id)
  try {
    const response = await unwrapAuthResponse(adminAuth.admin.unbanUser({
      userId: user.id
    }))
    updateUserStatus(user.id, response.user)
    toast.add({
      title: t('admin.users.accountUnbanned'),
      color: 'success'
    })
  } catch (err: unknown) {
    showStatusError(err, t('admin.users.unbanFailed'))
  } finally {
    statusUpdatingUserIds.value.delete(user.id)
  }
}

function updateUserStatus(userId: string, betterAuthUser: {
  banned?: boolean | null
  banReason?: string | null
  banExpires?: string | Date | null
  updatedAt?: string | Date
}) {
  usersPage.value = {
    ...usersPage.value,
    users: users.value.map(item =>
      item.id === userId
        ? {
            ...item,
            updatedAt: betterAuthUser.updatedAt ?? item.updatedAt,
            status: betterAuthUser.banned ? 'banned' : 'active',
            banReason: betterAuthUser.banReason ?? null,
            banExpires: betterAuthUser.banExpires ?? null
          }
        : item
    )
  }
}

function showStatusError(err: unknown, title: string) {
  const message = (err as { data?: { message?: string } })?.data?.message
    ?? (err instanceof Error ? err.message : t('admin.users.statusFailed'))
  toast.add({
    title,
    description: message,
    color: 'error'
  })
}

async function loadUsers(pageNumber: number): Promise<AdminUsersPage> {
  return requestFetch('/api/admin/users', {
    query: {
      page: pageNumber,
      pageSize
    }
  })
}

function emptyUsersPage(page: number): AdminUsersPage {
  return {
    users: [],
    total: 0,
    page,
    pageSize
  }
}

function parsePage(value: typeof route.query.page) {
  const rawValue = Array.isArray(value) ? value[0] : value
  const page = Number(rawValue ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function pageQuery(page: number) {
  return {
    ...route.query,
    page: page > 1 ? String(page) : undefined
  }
}

async function unwrapAuthResponse<T>(promise: Promise<{ data: T | null, error: { message?: string, statusText?: string } | null }>) {
  const { data, error } = await promise
  if (error || !data) {
    throw new Error(error?.message ?? error?.statusText ?? t('admin.users.requestFailed'))
  }
  return data
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="$t('ui.users')"
      :description="$t('admin.users.count', totalUsers)"
    />

    <UPageBody>
      <div
        v-if="isInitialLoading"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="$t('ui.couldNotLoadUsers')"
        :description="error.message"
      />

      <UCard
        v-else-if="users.length === 0"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-users"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          {{ $t('ui.noRegisteredUsers') }}
        </h2>
        <p class="text-muted">
          {{ $t('ui.signedUpUsersWillAppearHere') }}
        </p>
      </UCard>

      <template v-else>
        <UTable
          :data="users"
          :columns="columns"
        >
          <template #lastSessionActivityAt-header>
            <UTooltip :text="$t('admin.users.sessionHelp')">
              <span>{{ $t('ui.lastSessionUpdate') }}</span>
            </UTooltip>
          </template>

          <template #createdAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatAdminDateTime(originalUser(row).createdAt, locale, $t('admin.never')) }}</span>
          </template>

          <template #lastSessionActivityAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatAdminDateTime(originalUser(row).lastSessionActivityAt, locale, $t('admin.never')) }}</span>
          </template>

          <template #role-cell="{ row }">
            <UBadge
              :color="roleColor(originalUser(row).role)"
              variant="subtle"
            >
              {{ $t(`admin.users.${originalUser(row).role}`) }}
            </UBadge>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :color="statusColor(originalUser(row).status)"
              variant="subtle"
            >
              {{ $t(`admin.users.${originalUser(row).status}`) }}
            </UBadge>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-1">
              <UButton
                v-if="originalUser(row).isAdmin"
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-shield-minus"
                :disabled="!canDemote(originalUser(row))"
                :loading="roleUpdatingUserIds.has(originalUser(row).id)"
                @click="setRole(originalUser(row), 'user')"
              >
                {{ $t('ui.demote') }}
              </UButton>
              <UButton
                v-else
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-shield-plus"
                :loading="roleUpdatingUserIds.has(originalUser(row).id)"
                @click="setRole(originalUser(row), 'admin')"
              >
                {{ $t('ui.promote') }}
              </UButton>

              <UButton
                v-if="originalUser(row).status === 'banned'"
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-user-check"
                :loading="statusUpdatingUserIds.has(originalUser(row).id)"
                @click="unbanUser(originalUser(row))"
              >
                {{ $t('ui.unban') }}
              </UButton>
              <UButton
                v-else
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-user-x"
                :disabled="!canBan(originalUser(row))"
                :loading="statusUpdatingUserIds.has(originalUser(row).id)"
                @click="banUser(originalUser(row))"
              >
                {{ $t('ui.ban') }}
              </UButton>
            </div>
          </template>
        </UTable>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-muted">
            {{ $t('admin.users.showing', { start: pageStart, end: pageEnd, total: totalUsers }) }}
          </p>

          <UPagination
            v-if="totalUsers > pageSize"
            v-model:page="currentPage"
            :total="totalUsers"
            :items-per-page="pageSize"
            show-edges
          />
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
