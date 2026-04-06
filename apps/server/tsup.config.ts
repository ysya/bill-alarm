import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/serve.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  esbuildOptions(options) {
    options.alias = { '@': path.resolve(__dirname, 'src') }
  },
  noExternal: ['@bill-alarm/shared'],
  external: ['@prisma/client', '@prisma/adapter-better-sqlite3', 'better-sqlite3'],
})
