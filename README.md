# Bill Alarm

Self-hosted credit card bill tracker with automatic email parsing and payment reminders.

Automatically scans your Gmail for credit card statements, extracts bill amounts and due dates from PDF attachments, and sends reminders via Telegram and Google Calendar.

## Features

- **Automatic email scanning** - Periodically fetches credit card statement emails via Gmail API
- **PDF bill parsing** - Extracts amount, due date from password-protected PDF statements
- **Payment reminders** - Telegram notifications and Google Calendar events before due dates
- **Multi-bank support** - Plugin-based parser system, easy to add new banks
- **LLM fallback** - Uses Gemini to parse bills when regex patterns fail

## Supported Banks

| Bank | Code |
|------|------|
| 玉山銀行 | esun |
| 元大銀行 | yuanta |
| 中國信託 | ctbc |
| 台新銀行 | taishin |
| 永豐銀行 | sinopac |
| 聯邦銀行 | ubot |
| 國泰世華 | cathay |

## Deployment

### Docker Compose (Recommended)

Create a `docker-compose.yml`:

```yaml
services:
  bill-alarm:
    image: ghcr.io/ysya/bill-alarm:latest
    ports:
      - "${PORT:-3100}:3000"
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open `http://localhost:3100` and configure Gmail OAuth, Telegram bot, and banks in the settings page.

### Update

```bash
docker compose pull && docker compose up -d
```

## Development

```bash
pnpm install
pnpm dev:server   # Hono on :3100
pnpm dev:web      # Nuxt on :3001 (proxies /api to :3100)
```

## Tech Stack

- **Frontend**: Nuxt 4 + shadcn-vue + UnoCSS
- **Backend**: Hono.dev on Node.js
- **Database**: Prisma + SQLite
- **Notifications**: Telegram Bot API + Google Calendar API
- **Email**: Gmail API (OAuth 2.0)

## License

MIT
