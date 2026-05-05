import type { Attachment } from './email/types.js'

async function parsePdf(buffer: Buffer, password?: string): Promise<string> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  if (doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) {
      throw new Error('PDF 密碼錯誤或未提供密碼')
    }
  }
  const pages: string[] = []
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i)
    const text = page.toStructuredText('preserve-whitespace').asText()
    pages.push(text)
  }
  return pages.join('\n')
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超時（${ms / 1000}秒）`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * Extract text content from a PDF buffer, optionally decrypting with a password.
 */
export async function extractPdfText(pdfBuffer: Buffer, password?: string): Promise<string | null> {
  try {
    const text = await withTimeout(parsePdf(pdfBuffer, password), 30_000, 'PDF 解析')
    return text.trim() || null
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('password') || msg.includes('encrypt')) {
      throw new Error(`PDF 密碼錯誤或未提供密碼: ${msg}`)
    }
    throw new Error(`PDF 解析失敗: ${msg}`)
  }
}

/**
 * Decrypt a PDF buffer using mupdf WASM, returning an unencrypted PDF buffer.
 * If no password is needed, returns the original buffer.
 */
export async function decryptPdf(pdfBuffer: Buffer, password?: string): Promise<Buffer> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf')
  if (doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) {
      throw new Error('PDF 密碼錯誤或未提供密碼')
    }
  }
  const pdf = doc.asPDF()
  if (!pdf) return pdfBuffer
  const output = pdf.saveToBuffer('decrypt,compress')
  return Buffer.from(output.asUint8Array())
}

/**
 * Extract PDF files from a ZIP buffer.
 */
export async function extractPdfsFromZip(zipBuffer: Buffer): Promise<Array<{ filename: string; data: Buffer }>> {
  // Use Node.js built-in ZIP handling via dynamic import of a lightweight approach
  // For simplicity, we'll try to use the AdmZip pattern
  const { default: AdmZip } = await import('adm-zip')
  const zip = new AdmZip(zipBuffer)
  const pdfs: Array<{ filename: string; data: Buffer }> = []

  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith('.pdf') && !entry.isDirectory) {
      pdfs.push({
        filename: entry.entryName,
        data: entry.getData(),
      })
    }
  }

  return pdfs
}

/**
 * Given a list of email attachments, extract all PDF buffers
 * (handling both direct PDFs and PDFs inside ZIPs).
 */
export async function getPdfBuffers(
  attachments: Attachment[],
  zipPassword?: string,
): Promise<Buffer[]> {
  const pdfs: Buffer[] = []

  for (const att of attachments) {
    if (att.contentType === 'application/pdf' || att.filename.endsWith('.pdf')) {
      pdfs.push(att.data)
    } else if (att.contentType === 'application/zip' || att.filename.endsWith('.zip')) {
      try {
        const extracted = await extractPdfsFromZip(att.data)
        pdfs.push(...extracted.map((e) => e.data))
      } catch (e) {
        // ZIP extraction failed, skip
      }
    }
  }

  return pdfs
}
