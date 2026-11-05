<script setup lang="ts">
import type { BookLocation, BookLocationTreeNode, BookLocationWithCount } from '~~/shared/types/book'
import LocationTreeNode from '~~/app/components/LocationTreeNode.vue'
import {
  calculateLocationCounts,
  computeLocationRepath,
  insertLocationLocally,
  isLocationDescendant
} from '~~/shared/utils/location-hierarchy'
import { getApiErrorMessage } from '~~/shared/utils/api-error'

const { t } = useI18n()

usePageTitle(() => t('ui.locations'))

const toast = useToast()

const newLocationName = ref('')
const isCreating = ref(false)
const isMutating = ref(false)
const deleteTarget = ref<BookLocationWithCount | null>(null)
const deleteMode = ref<'block' | 'clear' | 'move'>('block')
const deleteTargetLocationId = ref<string>()

const { data: locations, status } = await useFetch<BookLocationWithCount[]>('/api/locations', {
  headers: useRequestHeaders(['cookie'])
})

const locationTree = computed<BookLocationTreeNode[]>(() => {
  const nodes = new Map<string, BookLocationTreeNode>()
  for (const location of locations.value ?? []) {
    nodes.set(location.id, { ...location, children: [] })
  }

  const roots: BookLocationTreeNode[] = []
  for (const node of nodes.values()) {
    if (node.parentLocationId && nodes.has(node.parentLocationId)) {
      nodes.get(node.parentLocationId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (items: BookLocationTreeNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    for (const item of items) sortNodes(item.children)
  }

  sortNodes(roots)
  return roots
})

const flattenedLocationTree = computed(() => {
  const nodes: BookLocationTreeNode[] = []
  const visit = (node: BookLocationTreeNode) => {
    nodes.push(node)
    for (const child of node.children) visit(child)
  }

  for (const root of locationTree.value) visit(root)
  return nodes
})

const deleteMoveOptions = computed(() => {
  const target = deleteTarget.value
  return (locations.value ?? [])
    .filter(location => !target || (location.id !== target.id && !location.path.startsWith(`${target.path} - `)))
    .map(location => ({ label: location.path, value: location.id }))
})

const canConfirmDelete = computed(() => {
  if (!deleteTarget.value) return false
  if (deleteMode.value === 'move') return Boolean(deleteTargetLocationId.value)
  return true
})

function patchLocationLocally(
  targetLocation: BookLocationWithCount,
  name: string | undefined,
  parentLocation: BookLocationWithCount | null
) {
  const flatLocations = locations.value ?? []
  const currentTarget = flatLocations.find(location => location.id === targetLocation.id) ?? targetLocation
  const descendants = flatLocations.filter(location => isLocationDescendant(location, currentTarget))
  const repath = computeLocationRepath(currentTarget, descendants, parentLocation, name ?? currentTarget.name)
  const descendantPatches = new Map(repath.descendants.map(patch => [patch.id, patch]))
  const patchedLocations = flatLocations.map((location) => {
    if (location.id === currentTarget.id) {
      return {
        ...location,
        name: repath.location.name,
        parentLocationId: repath.location.parentLocationId,
        path: repath.location.path,
        depth: repath.location.depth
      }
    }

    const patch = descendantPatches.get(location.id)
    return patch
      ? { ...location, path: patch.path, depth: patch.depth }
      : location
  })

  locations.value = calculateLocationCounts(patchedLocations)
}

function reconcileLocationLocally(location: BookLocation) {
  const currentLocation = locations.value?.find(item => item.id === location.id)
  if (!currentLocation) return

  const parentLocation = location.parentLocationId
    ? locations.value?.find(item => item.id === location.parentLocationId) ?? null
    : null
  patchLocationLocally(currentLocation, location.name, parentLocation)
}

function addLocationLocally(location: BookLocation) {
  locations.value = insertLocationLocally(locations.value, location)
}

function deleteLocationLocally(
  targetLocation: BookLocationWithCount,
  mode: 'block' | 'clear' | 'move',
  targetLocationId?: string
) {
  const flatLocations = locations.value ?? []
  const scopedLocationIds = new Set(
    flatLocations
      .filter(location => location.id === targetLocation.id || isLocationDescendant(location, targetLocation))
      .map(location => location.id)
  )
  const movedBookCount = mode === 'move'
    ? flatLocations.reduce((total, location) => {
        return scopedLocationIds.has(location.id) ? total + location.directBookCount : total
      }, 0)
    : 0

  const patchedLocations = flatLocations
    .filter(location => !scopedLocationIds.has(location.id))
    .map((location) => {
      if (mode !== 'move' || location.id !== targetLocationId) return location

      const directBookCount = location.directBookCount + movedBookCount
      return {
        ...location,
        bookCount: directBookCount,
        directBookCount
      }
    })

  locations.value = calculateLocationCounts(patchedLocations)
}

async function createLocation(parentLocationId: string | null, name: string) {
  const trimmedName = name.trim()
  if (!trimmedName || isCreating.value || isMutating.value) return

  isCreating.value = true
  isMutating.value = true
  try {
    const location = await $fetch<BookLocation>('/api/locations', {
      method: 'POST',
      body: { name: trimmedName, parentLocationId }
    })
    newLocationName.value = ''
    addLocationLocally(location)
    toast.add({ title: t('ui.locationAdded'), color: 'success' })
  } catch (err: unknown) {
    showErrorToast(t('ui.locationAddFailed'), err)
  } finally {
    isCreating.value = false
    isMutating.value = false
  }
}

async function renameLocation(locationId: string, name: string) {
  if (isMutating.value) return

  const rollbackLocations = locations.value?.map(location => ({ ...location })) ?? []
  const location = locations.value?.find(location => location.id === locationId)
  const parentLocation = location?.parentLocationId
    ? locations.value?.find(item => item.id === location.parentLocationId) ?? null
    : null

  isMutating.value = true
  try {
    if (location) patchLocationLocally(location, name, parentLocation)

    const updatedLocation = await $fetch<BookLocation>(`/api/locations/${locationId}/rename`, {
      method: 'PUT',
      body: { name }
    })
    reconcileLocationLocally(updatedLocation)
    toast.add({ title: t('ui.locationRenamed'), color: 'success' })
  } catch (err: unknown) {
    locations.value = rollbackLocations
    showErrorToast(t('ui.locationRenameFailed'), err)
  } finally {
    isMutating.value = false
  }
}

async function moveLocation(locationId: string, parentLocationId: string | null) {
  if (isMutating.value) return

  const rollbackLocations = locations.value?.map(location => ({ ...location })) ?? []
  const location = locations.value?.find(location => location.id === locationId)
  const parentLocation = parentLocationId
    ? locations.value?.find(location => location.id === parentLocationId) ?? null
    : null

  isMutating.value = true
  try {
    if (location) patchLocationLocally(location, undefined, parentLocation)

    const updatedLocation = await $fetch<BookLocation>(`/api/locations/${locationId}/move`, {
      method: 'PUT',
      body: { parentLocationId }
    })
    reconcileLocationLocally(updatedLocation)
    toast.add({ title: t('ui.locationMoved'), color: 'success' })
  } catch (err: unknown) {
    locations.value = rollbackLocations
    showErrorToast(t('ui.locationMoveFailed'), err)
  } finally {
    isMutating.value = false
  }
}

function openDelete(location: BookLocationWithCount) {
  deleteTarget.value = location
  deleteMode.value = location.directBookCount + location.descendantBookCount > 0 ? 'block' : 'clear'
  deleteTargetLocationId.value = undefined
}

async function deleteLocation() {
  if (isMutating.value || !deleteTarget.value || !canConfirmDelete.value) return

  const targetLocation = locations.value?.find(location => location.id === deleteTarget.value?.id)
  const targetLocationId = deleteTargetLocationId.value
  const rollbackLocations = locations.value?.map(location => ({ ...location })) ?? []

  isMutating.value = true
  try {
    const hasAssignedBooks = targetLocation
      ? targetLocation.directBookCount + targetLocation.descendantBookCount > 0
      : false
    const canOptimisticallyDelete = deleteMode.value !== 'block' || !hasAssignedBooks
    if (targetLocation && canOptimisticallyDelete) {
      deleteLocationLocally(targetLocation, deleteMode.value, targetLocationId)
    }

    await $fetch(`/api/locations/${deleteTarget.value.id}`, {
      method: 'DELETE',
      query: deleteMode.value === 'move'
        ? { mode: 'move', targetLocationId: deleteTargetLocationId.value }
        : { mode: deleteMode.value }
    })
    deleteTarget.value = null
    toast.add({ title: t('ui.locationDeleted'), color: 'success' })
  } catch (err: unknown) {
    locations.value = rollbackLocations
    showErrorToast(t('ui.locationDeleteFailed'), err)
  } finally {
    isMutating.value = false
  }
}

function showErrorToast(title: string, err: unknown) {
  const message = getApiErrorMessage(err, t('ui.genericError'))
  toast.add({ title, description: message, color: 'error' })
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="$t('ui.locations')"
      :description="locations ? $t('library.locationCount', locations.length) : undefined"
    >
      <template #links>
        <UButton
          icon="i-lucide-library"
          color="neutral"
          variant="outline"
          to="/library"
        >
          {{ $t('ui.library') }}
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="mb-6 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <UInput
          v-model="newLocationName"
          icon="i-lucide-map-pin-plus"
          size="lg"
          :placeholder="$t('ui.newTopLevelLocation')"
          @keyup.enter="createLocation(null, newLocationName)"
        />
        <UButton
          icon="i-lucide-plus"
          size="lg"
          :loading="isCreating"
          :disabled="!newLocationName.trim() || isCreating || isMutating"
          @click="createLocation(null, newLocationName)"
        >
          {{ $t('ui.addLocation') }}
        </UButton>
      </div>

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
        v-else-if="locationTree.length === 0"
        class="py-12 text-center"
      >
        <UIcon
          name="i-lucide-map"
          class="mx-auto mb-4 text-6xl text-muted"
        />
        <h2 class="mb-2 text-xl font-semibold">
          {{ $t('ui.noLocationsYet') }}
        </h2>
        <p class="text-muted">
          {{ $t('ui.addAShelfRoomBoxOrAny') }}
        </p>
      </UCard>

      <ul
        v-else
        class="space-y-3"
      >
        <LocationTreeNode
          v-for="node in flattenedLocationTree"
          :key="node.id"
          :node="node"
          :locations="locations ?? []"
          :style="{ marginLeft: `${node.depth * 1.25}rem` }"
          @add="(parentLocationId, name) => createLocation(parentLocationId, name)"
          @rename="renameLocation"
          @move="moveLocation"
          @delete="openDelete"
        />
      </ul>
    </UPageBody>

    <UModal
      :open="Boolean(deleteTarget)"
      :title="$t('ui.deleteLocation')"
      :description="deleteTarget ? $t('ui.locationDeleteDescription', { path: deleteTarget.path }) : undefined"
      :ui="{ content: 'sm:max-w-lg', footer: 'justify-end gap-2' }"
      @update:open="value => { if (!value) deleteTarget = null }"
    >
      <template #body>
        <div
          v-if="deleteTarget"
          class="space-y-4"
        >
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                {{ $t('ui.direct') }}
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.directBookCount }}
              </p>
            </div>
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                {{ $t('ui.nested') }}
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.descendantBookCount }}
              </p>
            </div>
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                {{ $t('ui.total') }}
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.directBookCount + deleteTarget.descendantBookCount }}
              </p>
            </div>
          </div>

          <URadioGroup
            v-model="deleteMode"
            :items="[
              { label: $t('ui.locationDeleteBlock'), value: 'block' },
              { label: $t('ui.locationDeleteClear'), value: 'clear' },
              { label: $t('ui.locationDeleteMove'), value: 'move' }
            ]"
          />

          <USelect
            v-if="deleteMode === 'move'"
            v-model="deleteTargetLocationId"
            :items="deleteMoveOptions"
            :placeholder="$t('ui.moveBooksTo')"
            class="w-full"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="soft"
          @click="() => { deleteTarget = null }"
        >
          {{ $t('ui.cancel') }}
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="isMutating"
          :disabled="!canConfirmDelete || isMutating"
          @click="deleteLocation"
        >
          {{ $t('ui.delete') }}
        </UButton>
      </template>
    </UModal>
  </UContainer>
</template>
