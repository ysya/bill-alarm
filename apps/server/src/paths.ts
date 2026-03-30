import path from 'node:path'

/** apps/server/ (dev) or /app (Docker) */
const SERVER_ROOT = path.resolve(import.meta.dirname, '..')

/** Persistent data directory — override with DATA_DIR env var for Docker */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(SERVER_ROOT, 'data')

/** PDF storage directory */
export const PDF_DIR = path.join(DATA_DIR, 'pdfs')

/** SQLite database URL */
export const DATABASE_URL = process.env.DATABASE_URL ?? `file:${path.join(DATA_DIR, 'bill-alarm.db')}`
