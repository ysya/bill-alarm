export default defineNuxtRouteMiddleware(async () => {
  const { me, isAdmin, fetchMe } = useAuth()
  // auth.global.ts populates `authed` but not `me`, and app.vue only fetches
  // `me` in onMounted — so on a direct load `me` is null here. Fetch it before
  // deciding, otherwise a member would slip through (isAdmin stays false and a
  // watcher would never fire).
  if (!me.value) await fetchMe()
  if (!isAdmin.value) return navigateTo('/settings')
})
