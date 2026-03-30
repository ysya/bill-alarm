import { defineConfig } from 'unocss'
import { presetWind } from '@unocss/preset-wind3'
import presetAnimations from 'unocss-preset-animations'
import { presetShadcn } from 'unocss-preset-shadcn'

export default defineConfig({
  safelist: [
    // Switch component uses data-attribute variants that static scan misses
    'data-[state=checked]:bg-primary',
    'data-[state=unchecked]:bg-input',
    'data-[state=checked]:translate-x-5',
    'bg-background',
    'bg-input',
    'bg-primary',
  ],
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
    inline: [
      // Force include shadcn component classes that static scan misses
      'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input bg-background bg-input bg-primary data-[state=checked]:translate-x-5 ring-offset-background focus-visible:ring-ring focus-visible:ring-offset-2',
    ],
  },
})
