import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

function resolveProjectAlias(specifier) {
  let relativePath
  if (specifier.startsWith('~~/')) relativePath = specifier.slice(3)
  else if (specifier.startsWith('~/') || specifier.startsWith('@/')) {
    relativePath = `app/${specifier.slice(2)}`
  } else {
    return
  }

  const basePath = `${projectRoot}${relativePath}`
  return [basePath, `${basePath}.ts`, `${basePath}/index.ts`].find(existsSync)
}

export function resolve(specifier, context, nextResolve) {
  const resolvedPath = resolveProjectAlias(specifier)
  if (!resolvedPath) return nextResolve(specifier, context)
  return { url: pathToFileURL(resolvedPath).href, shortCircuit: true }
}
