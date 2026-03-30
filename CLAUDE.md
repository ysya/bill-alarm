# Bill Alarm

信用卡帳單追蹤與繳費提醒系統。

## Tech Stack

- **Monorepo**: pnpm workspace
- **Frontend**: Nuxt 4 + shadcn-vue + UnoCSS (apps/web)
- **Backend**: Hono.dev on Node.js (apps/server)
- **Database**: Prisma + SQLite
- **Notifications**: Telegram Bot API + Google Calendar API
- **Email**: Gmail API (OAuth 2.0)
- **Deploy**: Docker (single container)

## Development

```bash
pnpm install
pnpm dev:server   # Hono on :3100
pnpm dev:web      # Nuxt on :3001 (proxies /api to :3100)
```

## Project Structure

- `apps/server/src/routes/` — Hono API routes
- `apps/server/src/services/` — Gmail, Telegram, Calendar, notification, scheduler services
- `apps/server/src/parsers/` — Bank email parsers (plugin pattern, one file per bank)
- `apps/server/src/db/` — Prisma schema and client
- `apps/web/pages/` — Nuxt pages
- `apps/web/components/ui/` — shadcn-vue components (auto-generated, do not edit)
- `apps/web/composables/` — API composables
- `packages/shared/` — Shared types and constants

## Conventions

- Bank email parsers implement `BillEmailParser` interface from `packages/shared/types.ts`
- Adding a new bank: create `apps/server/src/parsers/<bank>.ts` and register in `registry.ts`
- shadcn-vue component exports: check `index.ts` in each component dir (e.g. Sonner exports as `Toaster`)
- SQLite JSON columns stored as stringified JSON, parse in application code
- No authentication — single-user homelab app
- Server default port: 3100, Web dev port: 3001
