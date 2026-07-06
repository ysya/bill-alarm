export default defineNuxtConfig({
  modules: ['@unocss/nuxt', 'shadcn-nuxt', '@nuxt/eslint', '@vite-pwa/nuxt'],
  ssr: false,
  css: ['@unocss/reset/tailwind.css', '~/assets/css/main.css'],
  devtools: { enabled: true },
  compatibilityDate: '2024-11-01',
  app: {
    head: {
      title: 'Bill Alarm',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
        { name: 'theme-color', content: '#09090b' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' },
        // @vite-pwa/nuxt 只透過 <VitePwaManifest/> component 注入這個 link,
        // 但 app.vue 不在本任務範圍內,故手動加(等同 apple-touch-icon 的靜態作法)
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },
  nitro: {
    devProxy: {
      '/api': { target: 'http://localhost:3100/api', changeOrigin: true },
    },
  },
  shadcn: {
    prefix: '',
    componentDir: './components/ui',
  },
  eslint: {
    config: {
      stylistic: {
        semi: false,
        quotes: 'single',
      },
    },
  },
  pwa: {
    registerType: 'autoUpdate',
    // vite-plugin-pwa 預設 dev 模式不啟用 SW(devOptions.enabled 預設 false),
    // 開啟才能在 `pnpm dev:web` 用 Chrome DevTools 驗證 dev-sw 註冊狀況
    devOptions: {
      enabled: true,
    },
    client: {
      installPrompt: true,
    },
    manifest: {
      name: 'Bill Alarm',
      short_name: 'Bill Alarm',
      description: '信用卡帳單追蹤與繳費提醒',
      lang: 'zh-TW',
      display: 'standalone',
      start_url: '/',
      theme_color: '#09090b',
      background_color: '#09090b',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // pdf.js（vue-pdf-embed，帳單 PDF 檢視用）單一 chunk 約 2.4 MiB，超過 workbox 預設 2 MiB 上限會導致建置失敗
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      // SPA 導覽離線 fallback；API 絕不可被 SW 攔走（帳務資料不可吃舊快取）
      navigateFallback: '/200.html',
      navigateFallbackDenylist: [/^\/api\//],
    },
  },
})
