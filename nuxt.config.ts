import { fileURLToPath } from 'node:url'
import { version as projVersion } from './public/version.json'

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@nuxt/ui', '@nuxtjs/color-mode', '@vueuse/nuxt', '@nuxtjs/i18n'],

  runtimeConfig: {
    public: {
      version: projVersion,
      serverMode: process.env.NUXT_PUBLIC_SERVER_MODE === 'true',
      // Server mode configuration - exposed to frontend
      aiProvider: process.env.NUXT_PUBLIC_AI_PROVIDER || 'openai-compatible',
      aiModel: process.env.NUXT_PUBLIC_AI_MODEL || 'gpt-4o-mini',
      aiContextSize: parseInt(process.env.NUXT_PUBLIC_AI_CONTEXT_SIZE || '256000'),
      // 0 = unset: the provider decides the output limit
      aiMaxOutputTokens: positiveInteger(process.env.NUXT_PUBLIC_AI_MAX_OUTPUT_TOKENS, 0),
      webSearchProvider: process.env.NUXT_PUBLIC_WEB_SEARCH_PROVIDER || 'tavily',
      webSearchConcurrencyLimit: parseInt(
        process.env.NUXT_PUBLIC_WEB_SEARCH_CONCURRENCY_LIMIT || '2',
      ),
      webSearchSearchLanguage: process.env.NUXT_PUBLIC_WEB_SEARCH_SEARCH_LANGUAGE || 'en',
      tavilyAdvancedSearch: process.env.NUXT_PUBLIC_TAVILY_ADVANCED_SEARCH === 'true',
      tavilySearchTopic: process.env.NUXT_PUBLIC_TAVILY_SEARCH_TOPIC || 'general',
      googlePseId: process.env.NUXT_PUBLIC_GOOGLE_PSE_ID,
      researchFeedbackTimeoutMs: positiveInteger(
        process.env.NUXT_PUBLIC_RESEARCH_FEEDBACK_TIMEOUT_MS,
        120_000,
      ),
      researchResearchTimeoutMs: positiveInteger(
        process.env.NUXT_PUBLIC_RESEARCH_RESEARCH_TIMEOUT_MS,
        900_000,
      ),
      researchReportTimeoutMs: positiveInteger(
        process.env.NUXT_PUBLIC_RESEARCH_REPORT_TIMEOUT_MS,
        300_000,
      ),
    },
    // Private server-only configuration
    aiApiKey: process.env.NUXT_AI_API_KEY,
    aiApiBase: process.env.NUXT_AI_API_BASE,
    webSearchApiKey: process.env.NUXT_WEB_SEARCH_API_KEY,
    webSearchApiBase: process.env.NUXT_WEB_SEARCH_API_BASE,
    // Optional password guarding the /api routes (server mode)
    accessPassword: process.env.NUXT_ACCESS_PASSWORD,
    // Outbound proxy (server-only). Supports http/https/socks5/socks5h/socks,
    // e.g. NUXT_PROXY_URL=socks5h://user:pass@gate.example.com:7777
    proxyUrl: process.env.NUXT_PROXY_URL,
    // Hosts bypassing the proxy (default: localhost,127.0.0.1,::1)
    noProxy: process.env.NUXT_NO_PROXY,
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
    locales: ['en', 'zh', 'nl', 'ko'],
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

  hooks: {
    // The Firecrawl SDK dynamically imports Node-only `undici` for its
    // websocket job watcher, which the browser `search()` path never uses.
    // Alias it to an empty stub in the *client* build so Rollup can bundle the
    // SDK without trying to resolve undici. Server (Nitro) keeps the real one.
    // Deprecated hook: Nuxt 5 shares one Vite config across environments, so this
    // must move to a plugin using `applyToEnvironment` when upgrading.
    // The config is typed Readonly; Nuxt always creates the nested plugins/resolve.
    'vite:extendConfig'(config, { isClient }) {
      if (isClient) {
        config.plugins?.push({
          name: 'tavily-tokenizer',
          enforce: 'pre',
          resolveId(source, importer) {
            if (source === 'js-tiktoken' && importer?.includes('/@tavily/core/')) {
              return fileURLToPath(new URL('./build/tavily-tokenizer.ts', import.meta.url))
            }
          },
        })
        if (config.resolve) {
          config.resolve.alias = {
            ...config.resolve.alias,
            undici: fileURLToPath(new URL('./build/undici-browser-stub.ts', import.meta.url)),
          }
        }
      }
    },
  },

  nitro: {
    compressPublicAssets: { brotli: true, gzip: true },
    // Nitro 2.12 follows pnpm peer-dependency symlinks while printing the output tree.
    // Keep errors visible while skipping that non-essential post-build traversal.
    logLevel: 1,
  },

  typescript: {
    // Customize app/server TypeScript config
    tsConfig: {
      compilerOptions: {
        strict: true,
      },
      // Paths are relative to the generated .nuxt/tsconfig.app.json
      include: ['../lib/**/*'],
      exclude: ['../lib/**/*.test.ts'],
    },
    // Customize build-time TypeScript config
    nodeTsConfig: {
      compilerOptions: {
        strict: true,
      },
    },
  },

  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-29',
  future: {
    compatibilityVersion: 4,
  },
  devtools: { enabled: true },
})
