/**
 * App version, read once from the public /api/health endpoint and cached in
 * shared state. Best-effort: the display is decorative, so any failure leaves
 * it null and the UI simply omits the line.
 */
export function useAppVersion() {
  const version = useState<string | null>('appVersion', () => null)

  async function fetchVersion(): Promise<void> {
    if (version.value) return
    try {
      const health = await $fetch<{ version?: string }>('/api/health')
      version.value = health.version ?? null
    }
    catch {
      // leave null — never block or surface an error over a version label
    }
  }

  return { version, fetchVersion }
}
