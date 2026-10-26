import type { AccessStatus } from '~~/shared/utils/access'
import { getAccessStatus } from '~~/server/utils/access'

/**
 * Anonymous status probe: tells the UI whether to prompt for a password.
 *
 * `serverMode` is included so the client can hide the research form on a deployment that refuses
 * API calls, instead of letting the visitor fill it in and then get a 401.
 */
export default defineEventHandler((event) => {
  const status: AccessStatus & { serverMode: boolean } = {
    ...getAccessStatus(event),
    serverMode: useRuntimeConfig(event).public.serverMode,
  }
  return status
})
