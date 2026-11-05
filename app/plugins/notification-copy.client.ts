import type { Toast } from '@nuxt/ui/composables/useToast'
import { shallowReactive, watch } from 'vue'

type CopyAction = NonNullable<Toast['actions']>[number] & { 'aria-label': string }

export default defineNuxtPlugin(() => {
  const { toasts } = useToast()
  const textFor = getClientTranslator()
  const copies = new Map<Toast['id'], { action: CopyAction, text: string }>()
  const notificationText = (toast: Toast) => [toast.title, toast.description]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')

  watch(toasts, (notifications) => {
    const activeIds = new Set(notifications.map(toast => toast.id))
    for (const id of copies.keys()) {
      if (!activeIds.has(id)) copies.delete(id)
    }
    for (const toast of notifications) {
      const text = notificationText(toast)
      if (!text) continue
      let copy = copies.get(toast.id)
      if (!copy) {
        const action = shallowReactive<CopyAction>({
          'label': textFor('ui.copy', 'Copy'),
          'aria-label': textFor('copy.copyNotification', 'Copy notification'),
          'icon': 'i-lucide-copy',
          'color': 'neutral',
          'variant': 'ghost',
          'closeOnClick': false,
          'onClick': async () => {
            const current = toasts.value.find(item => item.id === toast.id)
            if (!current) return
            try {
              await navigator.clipboard.writeText(notificationText(current))
              action.label = textFor('ui.copied', 'Copied')
              action['aria-label'] = textFor('copy.notificationCopied', 'Notification copied')
              action.icon = 'i-lucide-check'
            } catch {
              action.label = textFor('copy.copyFailed', 'Copy failed')
              action['aria-label'] = textFor('copy.copyFailedSelectText', 'Copy failed — select text to copy')
              action.icon = 'i-lucide-triangle-alert'
            }
          }
        })
        copy = { action, text }
        copies.set(toast.id, copy)
      }
      if (copy.text !== text) {
        copy.text = text
        copy.action.label = textFor('ui.copy', 'Copy')
        copy.action['aria-label'] = textFor('copy.copyNotification', 'Copy notification')
        copy.action.icon = 'i-lucide-copy'
      }
      // Preserve any existing notification actions and keep copying non-dismissive.
      if (!toast.actions?.includes(copy.action)) toast.actions = [...(toast.actions ?? []), copy.action]
    }
  }, { deep: true, immediate: true })
})
