const adminDateTimeOptions: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC'
}

const adminDateTimeFormatters = {
  en: new Intl.DateTimeFormat('en-GB', adminDateTimeOptions),
  sk: new Intl.DateTimeFormat('sk-SK', adminDateTimeOptions)
}

export function formatAdminDateTime(value: string | Date | null | undefined, locale = 'en', never = 'Never') {
  if (!value) return never
  return adminDateTimeFormatters[locale === 'sk' ? 'sk' : 'en'].format(new Date(value))
}
