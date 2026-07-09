/**
 * 開發用腳本：從 Gmail (IMAP) 搜尋帳單信件，擷取 PDF 文字並存檔。
 *
 * 用法：
 *   cd apps/server
 *
 *   # 搜尋 HSBC 帳單並用密碼解密 PDF
 *   npx tsx scripts/email-pdf-extract.ts --query "from:hsbc 信用卡帳單" --password YOUR_PASSWORD
 *
 *   # 搜尋特定主旨
 *   npx tsx scripts/email-pdf-extract.ts -q "subject:(115年01月 信用卡帳單)" -p YOUR_PASSWORD
 *
 *   # 解析本機 PDF 檔案（不需要 Gmail 連線）
 *   npx tsx scripts/email-pdf-extract.ts --file ./data/pdfs/hsbc.pdf -p YOUR_PASSWORD
 *
 *   # 存檔到指定目錄
 *   npx tsx scripts/email-pdf-extract.ts -q "from:hsbc" -p YOUR_PASSWORD --out ./tmp
 *
 * `--query` 模式需要 IMAP 帳密（本 app 目前採每使用者存於 DB 的信箱設定，
 * 這支獨立腳本沒有登入狀態，改用環境變數 —— 可寫在 apps/server/.env）：
 *   IMAP_HOST（預設 imap.gmail.com）、IMAP_PORT（預設 993）、
 *   IMAP_USER、IMAP_PASSWORD（Gmail 需使用應用程式密碼）
 * `--file` 模式完全不需要這些變數。
 *
 * 輸出：
 *   - 終端印出 PDF 全文
 *   - 如果有 --out，會將 PDF 和文字檔存到該目錄
 */
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getEmailProviderFor } from '../src/services/email/index.js'
import { extractPdfText, getPdfBuffers } from '../src/services/pdf-parser.js'

const { values } = parseArgs({
  options: {
    query:    { type: 'string', short: 'q' },
    password: { type: 'string', short: 'p' },
    file:     { type: 'string', short: 'f' },
    out:      { type: 'string', short: 'o' },
    limit:    { type: 'string', short: 'n', default: '5' },
    help:     { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log(`
用法: npx tsx scripts/email-pdf-extract.ts [options]

選項:
  -q, --query <gmail query>   Gmail 搜尋語法
  -p, --password <password>   PDF 解密密碼
  -f, --file <path>           直接解析本機 PDF 檔案（跳過 Gmail）
  -o, --out <dir>             將 PDF 和文字檔存到指定目錄
  -n, --limit <number>        最多處理幾封信（預設 5）
  -h, --help                  顯示說明
`)
  process.exit(0)
}

// ─── 本機 PDF 模式 ───────────────────────────────────────────────
async function handleLocalFile(filePath: string, password?: string, outDir?: string) {
  const buf = Buffer.from(await fs.readFile(filePath))
  const text = await extractPdfText(buf, password)
  if (!text) {
    console.error('無法擷取 PDF 文字。')
    process.exit(1)
  }

  console.log('\n========== PDF TEXT ==========')
  console.log(text)
  console.log('==============================')
  console.log(`\n字元數: ${text.length}  行數: ${text.split('\n').length}`)

  if (outDir) {
    await fs.mkdir(outDir, { recursive: true })
    const base = path.basename(filePath, '.pdf')
    const txtPath = path.join(outDir, `${base}.txt`)
    await fs.writeFile(txtPath, text)
    console.log(`文字檔已存到: ${txtPath}`)
  }
}

// ─── Gmail 搜尋模式 ──────────────────────────────────────────────
async function handleGmailSearch(query: string, password?: string, outDir?: string, limit = 5) {
  // 0. 讀取 IMAP 帳密（獨立腳本沒有登入狀態，改用環境變數）
  const imapUser = process.env.IMAP_USER
  const imapPassword = process.env.IMAP_PASSWORD
  if (!imapUser || !imapPassword) {
    console.error('缺少 IMAP_USER / IMAP_PASSWORD 環境變數，請先設定後再執行（可寫在 apps/server/.env）。')
    process.exit(1)
  }
  const provider = getEmailProviderFor({
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    imapPort: Number(process.env.IMAP_PORT) || 993,
    imapUser,
    imapPassword,
  })
  if (!provider) {
    // 理論上不會發生（上面已檢查過 imapUser/imapPassword），但
    // getEmailProviderFor 的型別是 EmailProvider | null，明確處理而非斷言。
    console.error('缺少 IMAP_USER / IMAP_PASSWORD 環境變數，請先設定後再執行。')
    process.exit(1)
  }

  // 1. 檢查連線
  const status = await provider.verify()
  if (!status.ok) {
    console.error(`Gmail 未連線: ${status.error}`)
    console.error('\n請確認 IMAP_USER / IMAP_PASSWORD 是否正確（Gmail 需使用應用程式密碼）。')
    process.exit(1)
  }
  console.log(`Gmail 已連線: ${status.email}`)

  // 2. 搜尋
  console.log(`\n搜尋: ${query}`)
  const refs = await provider.withSession((session) => session.search({ query, sinceDays: 30, maxResults: limit }))
  console.log(`找到 ${refs.length} 封信件\n`)

  if (refs.length === 0) return

  if (outDir) await fs.mkdir(outDir, { recursive: true })

  // 3. 逐封處理
  for (let i = 0; i < refs.length; i++) {
    const email = await provider.fetchOne(refs[i].id)
    if (!email) continue

    console.log(`[${i + 1}/${refs.length}] ${email.subject}`)
    console.log(`  From: ${email.from}`)
    console.log(`  Date: ${email.date.toISOString()}`)
    console.log(`  Attachments: ${email.attachments.map(a => a.filename).join(', ') || '(none)'}`)

    const pdfBuffers = await getPdfBuffers(email.attachments)
    if (pdfBuffers.length === 0) {
      console.log('  → 沒有 PDF 附件，跳過\n')
      continue
    }

    for (let j = 0; j < pdfBuffers.length; j++) {
      const buf = pdfBuffers[j]
      const label = `email${i + 1}_pdf${j + 1}`

      try {
        const text = await extractPdfText(buf, password)
        if (!text) {
          console.log(`  → PDF #${j + 1}: 無法擷取文字`)
          continue
        }

        console.log(`\n========== ${label} (${text.length} chars) ==========`)
        console.log(text)
        console.log(`========== /${label} ==========\n`)

        if (outDir) {
          await fs.writeFile(path.join(outDir, `${label}.pdf`), buf)
          await fs.writeFile(path.join(outDir, `${label}.txt`), text)
          console.log(`  → 已存到 ${outDir}/${label}.{pdf,txt}`)
        }
      } catch (e) {
        console.error(`  → PDF #${j + 1} 錯誤: ${(e as Error).message}`)
      }
    }
    console.log()
  }
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  if (values.file) {
    await handleLocalFile(values.file, values.password, values.out)
  } else if (values.query) {
    await handleGmailSearch(values.query, values.password, values.out, parseInt(values.limit!))
  } else {
    console.error('請指定 --query 或 --file，用 --help 查看說明。')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
