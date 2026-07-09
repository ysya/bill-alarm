import type { Context } from 'hono'
import { getAuthUser } from '@/routes/auth.js'

/** Mount after authGuard. 403s non-admin users. */
export async function adminOnly(c: Context, next: () => Promise<void>): Promise<Response | void> {
  if (getAuthUser(c).role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  return next()
}
