import { version as projVersion } from './public/version.json'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@pinia/nuxt',
    '@nuxt/ui',
    '@nuxtjs/color-mode',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
  ],

  runtimeConfig: {
    public: {
      version: projVersion,
    },
  },

  routeRules: {
    '/version.json': {
      cors: true,
      cache: false,
    },
  },

  i18n: {
    vueI18n: './i18n.config.ts',
    strategy: 'no_prefix',
    locales: ['en', 'zh', 'nl'],
    detectBrowserLanguage: {
      alwaysRedirect: true,
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },

  colorMode: {
    preference: 'system',
    dataValue: 'theme',
    classSuffix: '',
    storage: 'cookie',
  },

  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('js-tiktoken')) {
              return 'tiktoken'
            }
          },
        },
      },
    },
  },

  nitro: {
    compressPublicAssets: { brotli: true, gzip: true },
  },

  css: ['~/assets/css/main.css'],
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
})
