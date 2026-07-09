import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
  { ignores: ['dist/**', 'generated/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      // 既有程式碼大量使用 (e as Error) 斷言與少數 any，先不打型別戰
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
