import { defineConfig } from 'unocss'
import { presetWind } from '@unocss/preset-wind3'
import presetAnimations from 'unocss-preset-animations'
import { presetShadcn } from 'unocss-preset-shadcn'

export default defineConfig({
  presets: [
    presetWind(),
    presetAnimations(),
    presetShadcn(
      { color: 'zinc' },
      { componentLibrary: 'reka' },
    ),
  ],
  content: {
    pipeline: {
      include: [
        /\.(vue|[jt]sx?|html)($|\?)/,
        'components/**/*.{js,ts,vue}',
      ],
    },
  },
})
