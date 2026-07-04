export const useAuthed = () => useState<boolean | null>('authed', () => null)

export function useAuth() {
  const authed = useAuthed()

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    authed.value = false
    await navigateTo('/login')
  }

  return { authed, logout }
}
