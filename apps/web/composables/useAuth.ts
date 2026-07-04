export const useAuthed = () => useState<boolean | null>('authed', () => null)

export function useAuth() {
  const authed = useAuthed()

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    }
    finally {
      authed.value = false
      await navigateTo('/login')
    }
  }

  return { authed, logout }
}
