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

### 環境變數說明

`IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `EMAIL_PROVIDER` 環境變數不再被讀取。在多使用者版本中，每位使用者在 設定 → 信箱 自行設定郵箱帳號（Gmail App Password、IMAP 伺服器等）。

升級至多使用者版本時，不需強制重新登入。現有的管理員帳號會自動繼承所有已設定的帳單、銀行和日曆 URL，無需重新設定。若 `TELEGRAM_CHAT_ID` 環境變數曾用於設定通知，該變數不再被讀取，請升級後透過 設定 → 帳號 → Telegram 通知 重新綁定。

## Multi-Tenant 架構

每位使用者各自管理：
- **信箱帳號** (設定 → 信箱) — 連接 Gmail 或 IMAP 伺服器，掃描帳單郵件
- **已啟用銀行** — 選擇支援的銀行清單，用於帳單解析
- **通知規則** — 個人化的繳費提醒設定及 Telegram 通知
- **個人日曆 URL** — 綁定 Google Calendar，獲得提醒事件

管理員（首位建立的帳號）額外可管理：
- **使用者帳號** — 停用使用者（可復原）或永久刪除（清除其所有帳單和設定）
- **全域設定** — LLM 服務商、Telegram Bot Token、掃描週期等系統級設定

## 認證

多使用者帳密登入。首次啟動造訪任一頁面會導向 `/setup` 建立帳號密碼，
session 有效 30 天（活躍使用自動續期）。

### 重置帳號

刪除所有用戶帳號和登入 session 後，重新造訪網站會回到首次啟動的 `/setup` 頁面。此操作會同時孤立所有使用者的帳單、銀行、設定等資料。建議改用備份還原；此命令為鎖定情況下的最後手段。

主要方式（data 目錄是 bind mount，直接在主機上操作）：

    sqlite3 data/bill-alarm.db "DELETE FROM users; DELETE FROM sessions;"

主機沒有 sqlite3 時，可在容器內執行（透過 Prisma adapter 的相依解析）：

    docker compose exec bill-alarm node -e "
      const { createRequire } = require('node:module');
      const req = createRequire(require.resolve('@prisma/adapter-better-sqlite3'));
      const db = req('better-sqlite3')('/app/data/bill-alarm.db');
      db.prepare('DELETE FROM users').run();
      db.prepare('DELETE FROM sessions').run();
    "

執行後重新造訪網站即會回到 /setup，無需重啟容器。

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
