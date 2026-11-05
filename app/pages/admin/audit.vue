<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui/components/Table.vue'
import type { AdminAuditCategory, AdminAuditEntry, AdminAuditLogPage } from '~~/shared/types/admin-audit'
import { formatAdminDateTime } from '~/utils/admin-date-format'

const { t, locale, te } = useI18n()

usePageTitle(() => t('ui.adminAudit'))

const route = useRoute()
const router = useRouter()
const requestFetch = useRequestFetch()
const pageSize = 25
type AuditCategoryFilter = AdminAuditCategory | 'all'

const currentPage = computed({
  get: () => parsePage(route.query.page),
  set: (page: number) => {
    router.push({
      query: pageQuery(page)
    })
  }
})

const currentCategory = computed<AuditCategoryFilter>({
  get: () => parseCategory(route.query.category),
  set: (category) => {
    router.push({
      query: {
        ...route.query,
        category: category === 'all' ? undefined : category,
        page: undefined
      }
    })
  }
})

const { data: auditPage, status, error } = await useAsyncData<AdminAuditLogPage>(
  'admin-audit-log',
  () => requestFetch('/api/admin/audit', {
    query: {
      page: currentPage.value,
      pageSize,
      category: currentCategory.value === 'all' ? undefined : currentCategory.value
    }
  }),
  {
    lazy: true,
    default: () => emptyAuditPage(currentPage.value),
    watch: [currentPage, currentCategory]
  }
)

const entries = computed(() => auditPage.value.entries)
const totalEntries = computed(() => auditPage.value.total)
const totalPages = computed(() => Math.max(1, Math.ceil(totalEntries.value / pageSize)))
const pageStart = computed(() => totalEntries.value === 0 ? 0 : ((currentPage.value - 1) * pageSize) + 1)
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalEntries.value))
const isLoadingEntries = computed(() => ['idle', 'pending'].includes(status.value))
const isInvalidPage = computed(() => !isLoadingEntries.value && currentPage.value > totalPages.value)
const isInitialLoading = computed(() => (isLoadingEntries.value || isInvalidPage.value) && entries.value.length === 0)
const categoryFilters = computed<Array<{ label: string, value: AuditCategoryFilter, icon: string }>>(() => [
  { label: t('admin.audit.both'), value: 'all', icon: 'i-lucide-list-filter' },
  { label: t('ui.admin'), value: 'admin', icon: 'i-lucide-shield-check' },
  { label: t('admin.audit.auth'), value: 'auth', icon: 'i-lucide-key-round' }
])

if (isInvalidPage.value) {
  await navigateTo({ path: route.path, query: pageQuery(totalPages.value) }, { replace: true })
}

watch(isInvalidPage, (invalid) => {
  if (invalid) {
    router.replace({ query: pageQuery(totalPages.value) })
  }
})

const columns = computed<TableColumn<AdminAuditEntry>[]>(() => [
  { accessorKey: 'createdAt', header: t('admin.columns.when') },
  { accessorKey: 'category', header: t('admin.columns.type') },
  { id: 'actor', header: t('admin.columns.actor') },
  { accessorKey: 'action', header: t('admin.columns.action') },
  { id: 'target', header: t('admin.columns.target') },
  { accessorKey: 'metadata', header: t('admin.columns.details') }
])

function originalEntry(row: TableRow<AdminAuditEntry>) {
  return row.original
}

function formatAction(action: AdminAuditEntry['action']) {
  const key = `admin.auditActions.${action.replaceAll('.', '_')}`
  return te(key) ? t(key) : action.replace(/[._]/g, ' ')
}

function actionColor(action: AdminAuditEntry['action']) {
  if (action === 'user.banned') return 'error'
  if (action === 'user.unbanned') return 'success'
  if (action === 'user.role_changed') return 'primary'
  if (action.startsWith('auth.')) return 'warning'
  return 'neutral'
}

function categoryColor(category: AdminAuditCategory) {
  return category === 'auth' ? 'warning' : 'primary'
}

function formatCategory(category: AdminAuditCategory) {
  return category === 'auth' ? t('admin.audit.auth') : t('ui.admin')
}

function userDisplayName(entry: AdminAuditEntry, kind: 'actor' | 'target') {
  const user = entry[kind]
  if (user?.name) return user.name
  const userId = kind === 'actor' ? entry.actorUserId : entry.targetUserId
  if (userId) return t('admin.audit.deletedUser')
  return kind === 'actor' ? t('admin.audit.unauthenticated') : t('admin.audit.noTarget')
}

function userDisplayDetail(entry: AdminAuditEntry, kind: 'actor' | 'target') {
  const user = entry[kind]
  if (user?.email) return user.email
  const userId = kind === 'actor' ? entry.actorUserId : entry.targetUserId
  if (userId) return userId
  return kind === 'actor' ? t('admin.audit.noSignedInUser') : t('admin.audit.systemOrInvite')
}

function metadataRows(metadata: Record<string, unknown> | null) {
  if (!metadata) return []

  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      label: formatMetadataKey(key),
      value: formatMetadataValue(key, value)
    }))
}

function formatMetadataKey(key: string) {
  const translation = `admin.auditMetadata.${key}`
  if (te(translation)) return t(translation)
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase())
}

function formatMetadataValue(key: string, value: unknown) {
  if (key.endsWith('Role') && (value === 'admin' || value === 'user')) return t(`admin.users.${value}`)
  if (key.endsWith('Status') && (value === 'pending' || value === 'accepted' || value === 'expired' || value === 'revoked')) return t(`admin.invites.${value}`)
  if (key === 'scope' && (value === 'all' || value === 'other')) return t(value === 'all' ? 'admin.audit.scopeAll' : 'admin.audit.scopeOther')
  if (value instanceof Date) return formatAdminDateTime(value, locale.value)
  if (typeof value === 'boolean') return t(value ? 'ui.yes' : 'ui.no')
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatAdminDateTime(value, locale.value)
  return String(value)
}

function emptyAuditPage(page: number): AdminAuditLogPage {
  return {
    entries: [],
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

function parseCategory(value: typeof route.query.category): AuditCategoryFilter {
  const rawValue = Array.isArray(value) ? value[0] : value
  return rawValue === 'admin' || rawValue === 'auth' ? rawValue : 'all'
}

function pageQuery(page: number) {
  return {
    ...route.query,
    page: page > 1 ? String(page) : undefined
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="$t('ui.auditLog')"
      :description="$t('ui.sensitiveAdminActivityAcrossUsersAndInvites')"
    />

    <UPageBody>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="filter in categoryFilters"
          :key="filter.value"
          :icon="filter.icon"
          size="sm"
          :color="currentCategory === filter.value ? 'primary' : 'neutral'"
          :variant="currentCategory === filter.value ? 'solid' : 'outline'"
          @click="() => { currentCategory = filter.value }"
        >
          {{ filter.label }}
        </UButton>
      </div>

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
        :title="$t('ui.couldNotLoadAuditLog')"
        :description="error.message"
      />

      <UCard
        v-else-if="entries.length === 0"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-scroll-text"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          {{ $t('ui.noAuditEntriesYet') }}
        </h2>
        <p class="text-muted">
          {{ $t('ui.sensitiveAdminActionsWillAppearHere') }}
        </p>
      </UCard>

      <template v-else>
        <div class="max-w-full overflow-x-auto pb-2">
          <UTable
            :data="entries"
            :columns="columns"
            class="min-w-7xl"
          >
            <template #createdAt-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatAdminDateTime(originalEntry(row).createdAt, locale, $t('admin.never')) }}</span>
            </template>

            <template #category-cell="{ row }">
              <UBadge
                :color="categoryColor(originalEntry(row).category)"
                variant="subtle"
              >
                {{ formatCategory(originalEntry(row).category) }}
              </UBadge>
            </template>

            <template #actor-cell="{ row }">
              <div class="min-w-40">
                <p class="font-medium">
                  {{ userDisplayName(originalEntry(row), 'actor') }}
                </p>
                <p class="text-xs text-muted break-all">
                  {{ userDisplayDetail(originalEntry(row), 'actor') }}
                </p>
              </div>
            </template>

            <template #action-cell="{ row }">
              <UBadge
                :color="actionColor(originalEntry(row).action)"
                variant="subtle"
              >
                {{ formatAction(originalEntry(row).action) }}
              </UBadge>
            </template>

            <template #target-cell="{ row }">
              <div class="min-w-40">
                <p class="font-medium">
                  {{ userDisplayName(originalEntry(row), 'target') }}
                </p>
                <p class="text-xs text-muted break-all">
                  {{ userDisplayDetail(originalEntry(row), 'target') }}
                </p>
              </div>
            </template>

            <template #metadata-cell="{ row }">
              <dl
                v-if="metadataRows(originalEntry(row).metadata).length"
                class="grid min-w-96 max-w-xl gap-1 whitespace-normal text-sm"
              >
                <div
                  v-for="item in metadataRows(originalEntry(row).metadata)"
                  :key="item.label"
                  class="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
                >
                  <dt class="text-xs font-medium text-muted">
                    {{ item.label }}
                  </dt>
                  <dd class="break-all">
                    {{ item.value }}
                  </dd>
                </div>
              </dl>
              <span
                v-else
                class="text-sm text-muted"
              >
                {{ $t('ui.noDetails') }}
              </span>
            </template>
          </UTable>
        </div>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-muted">
            {{ $t('admin.audit.showing', { start: pageStart, end: pageEnd, total: totalEntries }) }}
          </p>

          <UPagination
            v-if="totalEntries > pageSize"
            v-model:page="currentPage"
            :total="totalEntries"
            :items-per-page="pageSize"
            show-edges
          />
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
