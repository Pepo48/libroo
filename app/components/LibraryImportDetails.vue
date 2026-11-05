<script setup lang="ts">
import type { LibraryImportResult, LibraryImportRowDetail } from '~~/shared/types/library-transfer'

const { t } = useI18n()

const props = defineProps<{ result: LibraryImportResult }>()
const open = ref(false)
const filter = ref('all')
const items = [
  { label: t('copy.allRows'), value: 'all' },
  { label: t('copy.alreadyInLibraryBeforeImport'), value: 'matched' },
  { label: t('copy.repeatedInThisCsv'), value: 'repeated' },
  { label: t('copy.errorsAndUnfinishedRows'), value: 'errors' }
]
const details = computed<LibraryImportRowDetail[]>(() => props.result.details ?? props.result.failed.map(failure => ({ ...failure, status: 'failed' as const })))
const isLibraryMatch = (row: LibraryImportRowDetail) => (row.status === 'updated' || row.status === 'skipped') && row.repeatedInFile === false
const visible = computed(() => details.value.filter(row => filter.value === 'all'
  || (filter.value === 'matched' && isLibraryMatch(row))
  || (filter.value === 'repeated' && 'repeatedInFile' in row && row.repeatedInFile)
  || (filter.value === 'errors' && (['failed', 'unconfirmed', 'not_processed'].includes(row.status) || row.coverWarning))))
const matchedCount = computed(() => props.result.updated + props.result.skipped)
const libraryMatches = computed(() => details.value.filter(isLibraryMatch).length)
const repeats = computed(() => details.value.filter(row => row.repeatedInFile === true && (row.status === 'updated' || row.status === 'skipped')).length)
const unknownMatches = computed(() => Math.max(0, matchedCount.value - libraryMatches.value - repeats.value))
const matchLabels = { libroo_id: t('copy.librooRecordId'), isbn: 'ISBN', title_authors: t('copy.titleAndAuthor') }
watch(() => props.result, () => {
  open.value = false
  filter.value = 'all'
})
</script>

<template>
  <div class="space-y-3">
    <template v-if="matchedCount">
      <template v-if="!unknownMatches">
        <p class="text-sm text-muted">
          {{ $t('copy.importLibraryMatches', libraryMatches) }}
        </p>
        <p class="text-sm text-muted">
          {{ $t('copy.importRepeatedMatches', repeats) }}
        </p>
      </template>
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ $t('copy.importUnknownMatches', { count: matchedCount, unknown: unknownMatches }) }}
      </p>
      <p class="text-sm text-muted">
        {{ repeats ? $t('copy.repeatedRowsAreIncludedInTheUpdatedSkippedTotalsAbove') + ' ' : '' }}{{ $t('ui.matchesCanOccurAcrossLocations') }}
      </p>
    </template>
    <UCollapsible
      v-model:open="open"
      class="space-y-3"
    >
      <UButton
        color="neutral"
        variant="outline"
        :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="open"
      >
        {{ open ? $t('copy.hideRowDetails') : $t('copy.showRowDetails') }} ({{ details.length }})
      </UButton>
      <template #content>
        <div class="space-y-3">
          <USelect
            v-model="filter"
            :items="items"
            :aria-label="$t('ui.filterImportDetails')"
            class="w-full"
          />
          <p
            v-if="!visible.length"
            class="text-sm text-muted"
          >
            {{ details.length ? $t('copy.noRowsMatchThisFilter') : $t('copy.rowDetailsAreUnavailableForThisReport') }}
          </p>
          <ul
            v-else
            class="max-h-80 divide-y divide-default overflow-y-auto"
            :aria-label="$t('ui.importRowDetails')"
          >
            <li
              v-for="row in visible"
              :key="row.row"
              class="space-y-1 py-3 text-sm"
            >
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="row.status === 'failed' ? 'error' : ['unconfirmed', 'not_processed'].includes(row.status) ? 'warning' : 'neutral'"
                  variant="soft"
                >
                  {{ $t(`copy.importStatus_${row.status}`) }}
                </UBadge>
                <span class="font-medium">{{ $t('ui.row') }} {{ row.row }}: {{ row.title }}</span>
              </div>
              <p
                v-if="'matchedBy' in row && row.matchedBy"
                class="text-muted"
              >
                {{ $t('copy.importMatchedBy', { title: row.matchedTitle || $t('copy.anExistingBook'), method: matchLabels[row.matchedBy] }) }}
              </p>
              <p
                v-if="isLibraryMatch(row)"
                class="text-muted"
              >
                {{ $t('ui.alreadyInYourLibraryBeforeThisImport') }}
              </p>
              <p
                v-if="'repeatedInFile' in row && row.repeatedInFile"
                class="text-muted"
              >
                {{ $t('copy.importRepeatedRow', { row: row.firstRow }) }}
              </p>
              <p
                v-if="row.reason"
                class="whitespace-pre-wrap text-muted"
              >
                {{ row.reason }}
              </p>
              <p
                v-if="row.coverWarning"
                class="text-warning"
              >
                {{ $t('settings.backup.coverWarning', { reason: row.coverWarning }) }}
              </p>
              <NuxtLink
                v-if="'userBookId' in row && row.userBookId"
                :to="`/library/${row.userBookId}`"
                target="_blank"
                class="text-primary underline"
              >{{ row.status === 'created' ? $t('copy.viewImportedBook') : $t('copy.viewMatchedBook') }}</NuxtLink>
            </li>
          </ul>
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
