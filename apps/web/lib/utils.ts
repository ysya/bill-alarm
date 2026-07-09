import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extracts the server-provided error message from a failed $fetch/ofetch call
 * (ofetch's FetchError shape: `{ data: { error: string } }`), falling back to
 * String(e) when the caught value isn't that shape (network error, etc).
 */
export function apiErrorMessage(e: unknown): string {
  const data = (e as { data?: { error?: string } } | null | undefined)?.data
  return data?.error ?? String(e)
}

/** True when a failed $fetch/ofetch call had the given HTTP status code. */
export function isApiErrorStatus(e: unknown, status: number): boolean {
  const err = e as { status?: number, statusCode?: number } | null | undefined
  return err?.status === status || err?.statusCode === status
}
