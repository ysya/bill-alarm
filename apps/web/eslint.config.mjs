// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      // 既有 API composables 大量以 any 承接後端回應，尚未建立共享型別，先不打型別戰
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
