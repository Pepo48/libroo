<template>
  <div
    role="status"
    :aria-label="$t('ui.loadingText')"
    class="flex justify-center py-12"
  >
    <UIcon
      name="i-lucide-loader-2"
      class="animate-spin text-4xl text-muted"
    />
  </div>
</template>
