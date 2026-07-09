// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    files: [
      'components/ui/calendar/CalendarHeading.vue',
    ],
    rules: {
      // shadcn-vue/reka-ui auto-generated component (see CLAUDE.md: components/ui/
      // is generated, do not edit). The `any` is in the codegen'd slot signature.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
