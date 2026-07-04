import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Point DATABASE_URL at a fresh temp SQLite file and create the schema.
 * MUST be called before importing '@/prisma.js' (or anything that imports it).
 */
export function setupTestDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-alarm-test-'))
  const url = `file:${path.join(dir, 'test.db')}`
  process.env.DATABASE_URL = url
  const serverRoot = path.resolve(import.meta.dirname, '../../../..')
  // Note: Prisma 7's `db push` no longer accepts `--skip-generate` (it no longer
  // auto-runs `generate` after pushing, so the flag became obsolete and unnecessary).
  execSync('pnpm exec prisma db push', {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  return url
}
