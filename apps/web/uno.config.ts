import { defineConfig } from 'unocss'
import { presetWind4 } from '@unocss/preset-wind4'
import presetAnimations from 'unocss-preset-animations'
import { presetShadcn } from 'unocss-preset-shadcn'

export default defineConfig({
  safelist: [],
  presets: [
    presetWind4(),
    presetAnimations(),
    presetShadcn({ color: 'zinc' }, { componentLibrary: 'reka' }),
  ],
  content: {
    pipeline: {
      include: [/\.(vue|[jt]sx?|html)($|\?)/, 'components/**/*.{js,ts,vue}'],
    },
    inline: [],
  },
})
