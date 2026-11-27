export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/setup') return

  const authed = useAuthed()
  if (authed.value === true) return

  try {
    await $fetch('/api/auth/me')
    authed.value = true
  }
  catch {
    const status = await $fetch<{ initialized: boolean }>('/api/auth/status')
      .catch(() => ({ initialized: true }))
    if (!status.initialized) return navigateTo('/setup')
    const bill = to.name === 'bills-id' ? to.params.id : undefined
    return navigateTo(typeof bill === 'string' ? { path: '/login', query: { bill } } : '/login')
  }
})
