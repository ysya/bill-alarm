import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/serve.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  external: ['@prisma/client', '@prisma/adapter-better-sqlite3', 'better-sqlite3'],
})
