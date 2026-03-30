import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/serve.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  esbuildOptions(options) {
    options.alias = { '@': path.resolve(__dirname, 'src') }
  },
  external: ['@prisma/client', '@prisma/adapter-better-sqlite3', 'better-sqlite3'],
})
