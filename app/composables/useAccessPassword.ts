import { ACCESS_PASSWORD_HEADER, type AccessStatus } from '~~/shared/utils/access'

/** Thrown when a server-mode API call is rejected for a missing or wrong access password. */
export class AccessDeniedError extends Error {
  override name = 'AccessDeniedError'
}

export function accessPasswordHeaders(password: string | undefined): Record<string, string> {
  return password ? { [ACCESS_PASSWORD_HEADER]: encodeURIComponent(password) } : {}
}

export function useAccessPassword() {
  const password = useLocalStorage('deep-research-access-password', '')
  const promptOpen = useState('access-password-prompt', () => false)

  async function checkAccess(candidate = password.value): Promise<AccessStatus> {
    const response = await fetch('/api/access', { headers: accessPasswordHeaders(candidate) })
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`)
    return response.json()
  }

  return {
    password,
    promptOpen,
    headers: () => accessPasswordHeaders(password.value),
    checkAccess,
  }
}
