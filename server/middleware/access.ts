import { getAccessStatus } from '~~/server/utils/access'

/** Guards every API route except the status probe when NUXT_ACCESS_PASSWORD is set. */
export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event)
  if (!pathname.startsWith('/api/') || pathname === '/api/access') return
  if (!getAccessStatus(event).authorized) {
    throw createError({ statusCode: 401, statusMessage: 'Access password required' })
  }
})
