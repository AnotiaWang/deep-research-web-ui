import { getAccessStatus } from '~~/server/utils/access'

export default defineEventHandler((event) => getAccessStatus(event))
