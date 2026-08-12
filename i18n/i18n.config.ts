import en from '~~/i18n/en.json'
import zh from '~~/i18n/zh.json'
import nl from '~~/i18n/nl.json'
import ko from '~~/i18n/ko.json'

export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'zh',
  availableLocales: ['en', 'zh', 'nl', 'ko'],
  messages: {
    en,
    zh,
    nl,
    ko,
  },
}))
