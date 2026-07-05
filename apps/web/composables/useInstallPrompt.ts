const DISMISS_KEY = 'pwa-banner-dismissed'

export function useInstallPrompt() {
  const nuxtApp = useNuxtApp()
  // @vite-pwa/nuxt injection — undefined when the PWA module is disabled
  const pwa = nuxtApp.$pwa as undefined | {
    showInstallPrompt?: boolean
    install?: () => Promise<void>
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    // iOS Safari legacy flag
    || (navigator as { standalone?: boolean }).standalone === true

  // Single-user iPhone context; desktop-UA iPads are out of scope.
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  const canNativeInstall = computed(() => !!pwa?.showInstallPrompt)
  const showEntry = computed(() => !isStandalone && (canNativeInstall.value || isIos))

  const dismissed = useState('pwa-banner-dismissed', () => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    }
    catch {
      return false
    }
  })
  const bannerVisible = computed(() => showEntry.value && !dismissed.value)

  const iosGuideOpen = useState('pwa-ios-guide-open', () => false)

  async function triggerInstall(): Promise<void> {
    if (canNativeInstall.value && pwa?.install) {
      await pwa.install()
      return
    }
    iosGuideOpen.value = true
  }

  function dismissBanner(): void {
    dismissed.value = true
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    }
    catch { /* private mode — banner just reappears next load */ }
  }

  return { showEntry, bannerVisible, canNativeInstall, isIos, iosGuideOpen, triggerInstall, dismissBanner }
}
