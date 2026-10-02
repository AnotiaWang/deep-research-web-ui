/**
 * Fail-fast: in server mode, an unsupported `NUXT_PUBLIC_AI_PROVIDER` throws
 * here so Nitro refuses to boot instead of silently falling back to the
 * OpenAI API base.
 */
import { getAiProviderError } from '~~/shared/utils/ai-model'

export default defineNitroPlugin(() => {
  const { serverMode, aiProvider } = useRuntimeConfig().public
  if (!serverMode) return

  const error = getAiProviderError(aiProvider)
  if (error) {
    throw new Error(`[ai-provider] Invalid NUXT_PUBLIC_AI_PROVIDER, refusing to boot: ${error}`)
  }
})
