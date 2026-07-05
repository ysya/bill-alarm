export interface MeInfo {
  username: string
  role: 'admin' | 'member'
  telegramBound: boolean
}

export const useAuthed = () => useState<boolean | null>('authed', () => null)
export const useMe = () => useState<MeInfo | null>('me', () => null)

export function useAuth() {
  const authed = useAuthed()
  const me = useMe()
  const isAdmin = computed(() => me.value?.role === 'admin')

  async function fetchMe(): Promise<void> {
    me.value = await $fetch<MeInfo>('/api/auth/me').catch(() => null)
  }

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    }
    catch {
      // ignore — local state is cleared and user is redirected regardless
    }
    finally {
      authed.value = false
      me.value = null
      await navigateTo('/login')
    }
  }

  return { authed, me, isAdmin, fetchMe, logout }
}
