<script setup lang="ts">
import type { LegalDocument } from '~~/shared/types/legal'

const { t } = useI18n()

definePageMeta({
  auth: false
})

const config = useRuntimeConfig()
const externalUrl = configuredLegalUrl(config.public.legalImprintUrl)

if (externalUrl) {
  await navigateTo(externalUrl, { external: true })
}

const { data, error, status } = await useFetch<LegalDocument>('/api/legal/imprint', {
  lazy: true,
  immediate: !externalUrl,
  default: () => ({
    markdown: null,
    configured: false
  })
})

const text = computed(() => data.value?.markdown ?? '')
const errorMessage = computed(() => error.value
  ? 'Check NUXT_LEGAL_IMPRINT_MARKDOWN_URL and make sure the Markdown source is reachable by the server.'
  : '')

useHead({
  title: t('ui.imprint')
})
</script>

<template>
  <LegalPage
    :title="$t('ui.imprint')"
    :description="$t('ui.legalNoticeForLibroo')"
    :text="text"
    :loading="status === 'idle' || status === 'pending'"
    :error-message="errorMessage"
  />
</template>
