export default defineNuxtConfig({
  modules: ['@unocss/nuxt', 'shadcn-nuxt', '@nuxt/eslint'],
  ssr: false,
  css: ['@unocss/reset/tailwind.css', '~/assets/css/main.css'],
  devtools: { enabled: true },
  compatibilityDate: '2024-11-01',
  app: {
    head: {
      title: 'Bill Alarm',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#09090b' },
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
})
