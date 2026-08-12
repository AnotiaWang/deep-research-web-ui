interface RandomUuidProvider {
  randomUUID?: () => string
}

let fallbackSequence = 0

export function createRuntimeId(
  provider: RandomUuidProvider | null = globalThis.crypto,
  now: () => number = Date.now,
  random: () => number = Math.random,
) {
  if (typeof provider?.randomUUID === 'function') {
    return provider.randomUUID.call(provider)
  }

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER
  const timestamp = now().toString(36)
  const sequence = fallbackSequence.toString(36)
  const entropy = Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36)
  return `${timestamp}-${sequence}-${entropy}`
}
