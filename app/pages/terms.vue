<script setup lang="ts">
import type { LegalDocument } from '~~/shared/types/legal'

const { t } = useI18n()

definePageMeta({
  auth: false
})

const config = useRuntimeConfig()
const externalUrl = configuredLegalUrl(config.public.legalTermsUrl)

if (externalUrl) {
  await navigateTo(externalUrl, { external: true })
}

const { data, error } = await useFetch<LegalDocument>('/api/legal/terms', {
  default: () => ({
    markdown: null,
    configured: false
  })
})

const text = computed(() => data.value?.markdown ?? '')
const errorMessage = computed(() => error.value
  ? 'Check NUXT_LEGAL_TERMS_MARKDOWN_URL and make sure the Markdown source is reachable by the server.'
  : '')

useHead({
  title: t('ui.termsOfService')
})
</script>

<template>
  <LegalPage
    :title="$t('ui.termsOfService')"
    :description="$t('ui.termsForUsingLibroo')"
    :text="text"
    :error-message="errorMessage"
  />
</template>
