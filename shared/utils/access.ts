/** Request header carrying the optional server-mode access password (URI-encoded). */
export const ACCESS_PASSWORD_HEADER = 'x-access-password'

export interface AccessStatus {
  /** Whether the server has an access password configured */
  required: boolean
  /** Whether the request carried the correct password (always true when not required) */
  authorized: boolean
}
