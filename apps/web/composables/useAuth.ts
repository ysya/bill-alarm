export const useAuthed = () => useState<boolean | null>('authed', () => null)

export function useAuth() {
  const authed = useAuthed()

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    }
    catch {
      // ignore — local state is cleared and user is redirected regardless
    }
    finally {
      authed.value = false
      await navigateTo('/login')
    }
  }

  return { authed, logout }
}
