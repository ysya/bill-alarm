import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The running app version, resolved once and cached.
 *
 * Prefers the APP_VERSION env var (lets ops override), otherwise walks up
 * from this module to the monorepo root `package.json` (the one named
 * `bill-alarm`, which release-it bumps) and reads its version. This works
 * both in dev (source under apps/server/src) and in the bundled Docker image
 * (dist under /app/apps/server, with the root package.json at /app), since
 * both sit below the app/repo root.
 */
let cached: string | null = null

export function getAppVersion(): string {
  if (cached === null) {
    cached = process.env.APP_VERSION || readRootVersion() || 'unknown'
  }
  return cached
}

function readRootVersion(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (pkg.name === 'bill-alarm' && typeof pkg.version === 'string') return pkg.version
    } catch {
      // no readable package.json at this level — keep walking up
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** test-only: clears the memoized value so env overrides can be exercised */
export function _resetVersionCache(): void {
  cached = null
}
