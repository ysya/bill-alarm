import type { Preset, PresetWind4Theme } from 'unocss'
import { defineConfig } from 'unocss'
import { presetWind4 } from '@unocss/preset-wind4'
import presetAnimations from 'unocss-preset-animations'
import { presetShadcn } from 'unocss-preset-shadcn'

export default defineConfig({
  safelist: [],
  presets: [
    presetWind4(),
    // Both packages still type themselves against @unocss/preset-mini's (wind3-era)
    // Theme, not wind4's — a known upstream lag, not a real config error. Runtime
    // behavior is unaffected (rule matching doesn't depend on the Theme type param);
    // this only re-asserts them against the Theme this project actually uses.
    presetAnimations() as unknown as Preset<PresetWind4Theme>,
    presetShadcn({ color: 'zinc' }, { componentLibrary: 'reka' }) as unknown as Preset<PresetWind4Theme>,
  ],
  content: {
    pipeline: {
      include: [/\.(vue|[jt]sx?|html)($|\?)/, 'components/**/*.{js,ts,vue}'],
    },
    inline: [],
  },
})
