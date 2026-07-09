// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {},
  },
  {
    files: [
      'composables/useBillApi.ts',
      'composables/useBankApi.ts',
      'composables/useSettingsApi.ts',
      'composables/useBankAccountApi.ts',
      'pages/settings/users.vue',
      'pages/bills/\\[id\\].vue',
      'components/settings/TelegramBindCard.vue',
      'components/settings/IntegrationTelegram.vue',
      'components/settings/IntegrationLLM.vue',
      'components/settings/ChangePasswordDialog.vue',
      'components/BillPdfViewer.vue',
      'components/ui/calendar/CalendarHeading.vue',
    ],
    rules: {
      // pre-existing `any` debt, typed properly in the shared-DTO phase; new code keeps the rule
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
