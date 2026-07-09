# Bill Alarm

Self-hosted credit card bill tracker with automatic email parsing and payment reminders.

Scans each user's mailbox via IMAP for credit card statements, extracts bill amounts and due dates from PDF attachments, and sends reminders via Telegram and a personal ICS calendar feed.

## Features

- **Automatic email scanning** - Periodically fetches credit card statement emails via per-user IMAP (Gmail App Password or any IMAP host)
- **PDF bill parsing** - Extracts amount, due date from password-protected PDF statements
- **Payment reminders** - Telegram notifications and a personal ICS calendar feed (subscribe from Google Calendar, Apple Calendar, Outlook, etc.) before due dates
- **Multi-bank support** - Plugin-based parser system, easy to add new banks
- **LLM fallback** - Supports Gemini, OpenAI, or Ollama (configurable) to parse bills when regex patterns fail

## Supported Banks

Banks with a hardcoded regex parser:

| Bank | Code |
|------|------|
| 玉山銀行 | esun |
| 元大銀行 | yuanta |
| 中國信託 | ctbc |
| 台新銀行 | taishin |
| 永豐銀行 | sinopac |
| 聯邦銀行 | ubot |
| 國泰世華 | cathay |
| 滙豐銀行（台灣） | hsbc_tw |

More banks ship as presets without a hardcoded parser — 彰化銀行 (`chb`) and 台北富邦 (`fubon`) — these parse via a user-configured template rule or the LLM fallback instead. See `BANK_PRESETS` in `packages/shared/constants.ts` for the full preset list, or add any other bank as a fully custom entry in the settings page.

## Deployment

### Docker Compose (Recommended)

Create a `docker-compose.yml`:

```yaml
services:
  bill-alarm:
    image: ghcr.io/ysya/bill-alarm:latest
    ports:
      - "${PORT:-3100}:80"
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

Open `http://localhost:3100`, finish the first-run setup (creates your account), then configure your mailbox, Telegram bot, and banks in the settings page.

### Update

**升級前建議先備份 `data/bill-alarm.db`**（bind mount 在 host 的 `./data` 目錄下，直接複製檔案即可）。容器啟動時會自動執行 `prisma migrate deploy`；跨版本升級若剛好經過 0.4 的 dueDate 欄位遷移（`DateTime` → `YYYY-MM-DD` 字串），該 migration 已測試過、風險低，但資料庫結構遷移一律建議升級前先備份。

```bash
cp data/bill-alarm.db data/bill-alarm.db.bak  # 建議：升級前備份
docker compose pull && docker compose up -d
```

### 環境變數說明

`IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `EMAIL_PROVIDER` 環境變數不再被讀取。在多使用者版本中，每位使用者在 設定 → 信箱 自行設定郵箱帳號（Gmail App Password、IMAP 伺服器等）。

升級至多使用者版本時，不需強制重新登入。現有的管理員帳號會自動繼承所有已設定的帳單、銀行和日曆 URL，無需重新設定。若 `TELEGRAM_CHAT_ID` 環境變數曾用於設定通知，該變數不再被讀取，請升級後透過 設定 → 帳號 → Telegram 通知 重新綁定。

#### `ENCRYPTION_KEY`（選用）

設定後，信箱密碼（IMAP password）、銀行 PDF 密碼、LLM API Key 等機敏欄位會以 AES-256-GCM 加密後存入 SQLite（實作見 `apps/server/src/services/secrets.ts`）。不設定時這些欄位以明碼儲存——對有 Cloudflare Access 等前置防護的單機家用環境，這是可接受的取捨。

**⚠️ 重要警告**：一旦設定過 `ENCRYPTION_KEY` 並存入加密資料後，**更換或遺失這把金鑰會讓所有已加密的值永久無法還原**（目前沒有金鑰輪替 / 重新加密機制）。請務必妥善備份 `ENCRYPTION_KEY`；已有加密資料後不要隨意變更它。

#### `TZ`

Docker image 已固定 `ENV TZ=Asia/Taipei`（見 `Dockerfile`），逾期判定、到期提醒等所有「日曆日」計算都以此時區為準，與部署主機本身的系統時區無關。

## Multi-Tenant 架構

每位使用者各自管理：
- **信箱帳號** (設定 → 信箱) — 連接 Gmail 或 IMAP 伺服器，掃描帳單郵件
- **已啟用銀行** — 選擇支援的銀行清單，用於帳單解析
- **通知規則** — 個人化的繳費提醒設定及 Telegram 通知
- **個人日曆訂閱（ICS Feed）** — 產生個人化訂閱網址，可訂閱到 Google Calendar、Apple 行事曆、Outlook 等任何支援 iCalendar 的應用程式

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
- **Notifications**: Telegram Bot API + ICS calendar feed (per-user, token-based subscription)
- **Email**: Per-user IMAP (Gmail App Password or any IMAP host)
- **LLM (optional)**: Gemini, OpenAI, or Ollama — configurable fallback for bill parsing

## License

MIT
