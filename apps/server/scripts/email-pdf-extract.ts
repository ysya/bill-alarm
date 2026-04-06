/**
 * 開發用腳本：從 Gmail 搜尋帳單信件，擷取 PDF 文字並存檔。
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
 * 輸出：
 *   - 終端印出 PDF 全文
 *   - 如果有 --out，會將 PDF 和文字檔存到該目錄
 */
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getConnectionStatus, searchEmails, getEmailWithAttachments } from '../src/services/gmail.js'
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
  // 1. 檢查連線
  const status = await getConnectionStatus()
  if (!status.connected) {
    console.error(`Gmail 未連線: ${status.message}`)
    console.error('\n請先啟動 app 並在設定頁面完成 Google OAuth 授權。')
    process.exit(1)
  }
  console.log(`Gmail 已連線: ${status.message}`)

  // 2. 搜尋
  console.log(`\n搜尋: ${query}`)
  const messageIds = await searchEmails(query, limit)
  console.log(`找到 ${messageIds.length} 封信件\n`)

  if (messageIds.length === 0) return

  if (outDir) await fs.mkdir(outDir, { recursive: true })

  // 3. 逐封處理
  for (let i = 0; i < messageIds.length; i++) {
    const email = await getEmailWithAttachments(messageIds[i])
    if (!email) continue

    console.log(`[${i + 1}/${messageIds.length}] ${email.subject}`)
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
