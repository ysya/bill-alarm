import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

// Point DATA_DIR at an isolated temp dir BEFORE importing '@/index.js' (which
// transitively imports '@/paths.js'). DATA_DIR is captured as a module-level
// const on first import, same ordering requirement setupTestDb() already
// documents for DATABASE_URL/'@/prisma.js'.
const previousDataDir = process.env.DATA_DIR
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-alarm-pdf-test-'))
process.env.DATA_DIR = dataDir

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { PDF_DIR } = await import('@/paths.js')
const { encryptSecret } = await import('@/services/secrets.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const PDF_PASSWORD = 'FixturePass123'

/**
 * Build a minimal, genuinely password-protected single-page PDF with mupdf
 * (already a server dependency — see services/pdf-parser.ts). This makes the
 * ownership-gate test below discriminating: if the gate on GET /:id/pdf were
 * removed, this exact file WOULD decrypt and serve successfully for a
 * foreign user too. A bill with no pdfPath at all (as used by the broader
 * tenant-isolation sweep) 404s either way and proves nothing about the gate
 * (MT4 carry-forward gap).
 */
async function buildEncryptedPdfFixture(password: string): Promise<Buffer> {
  const mupdf = await import('mupdf')
  const doc = new mupdf.PDFDocument()
  doc.insertPage(-1, doc.addPage([0, 0, 200, 200], 0, {}, ''))
  const buf = doc.saveToBuffer(`encrypt=aes-256,owner-password=${password},user-password=${password}`)
  return Buffer.from(buf.asUint8Array())
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await app.request('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: boss },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('bills: GET /:id/pdf ownership gate (discriminating, real encrypted PDF fixture)', () => {
  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
  })

  it('owner decrypts the real file; a foreign user is 404d before the file would ever be readable to them', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: {
        name: 'PDF Fixture Bank',
        emailSenderPattern: 'pdf@pdf',
        emailSubjectPattern: 'pdf',
        pdfPassword: PDF_PASSWORD,
        userId: bossUser!.id,
      },
    })

    fs.mkdirSync(PDF_DIR, { recursive: true })
    const filename = `${bank.id}_fixture.pdf`
    fs.writeFileSync(path.join(PDF_DIR, filename), await buildEncryptedPdfFixture(PDF_PASSWORD))

    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-07',
        amount: 999,
        dueDate: '2026-07-20',
        pdfPath: `pdfs/${filename}`,
      },
    })

    // Sanity check: the fixture is genuinely password-protected and genuinely
    // decryptable by the owner — this is what makes the foreign 404 below
    // meaningful rather than coincidental.
    const ownerRes = await app.request(`/api/bills/${bill.id}/pdf`, { headers: { Cookie: boss } })
    expect(ownerRes.status).toBe(200)
    expect(ownerRes.headers.get('content-type')).toBe('application/pdf')

    // Foreign user requesting the SAME bill: if the ownership gate in
    // GET /:id/pdf were removed, this request would decrypt fine too (same
    // real file on disk, same correct password on record) and return 200 —
    // so a 404 here actually discriminates the gate, unlike a bill with no
    // pdfPath at all.
    const foreignRes = await app.request(`/api/bills/${bill.id}/pdf`, { headers: { Cookie: kid } })
    expect(foreignRes.status).toBe(404)
  })
})

describe('bills: GET /:id/pdf decrypts an at-rest-encrypted bank.pdfPassword (secrets choke point)', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'bills-pdf-secrets-test-key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it('a bank.pdfPassword stored as enc:v1: ciphertext is decrypted correctly to open the real PDF', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: {
        name: 'PDF Fixture Bank (encrypted at rest)',
        emailSenderPattern: 'pdf-enc@pdf',
        emailSubjectPattern: 'pdf-enc',
        // Simulates what routes/banks.ts's write path produces: the real
        // encryptSecret(), not a hand-rolled fake ciphertext.
        pdfPassword: encryptSecret(PDF_PASSWORD),
        userId: bossUser!.id,
      },
    })

    fs.mkdirSync(PDF_DIR, { recursive: true })
    const filename = `${bank.id}_fixture.pdf`
    fs.writeFileSync(path.join(PDF_DIR, filename), await buildEncryptedPdfFixture(PDF_PASSWORD))

    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-07',
        amount: 555,
        dueDate: '2026-07-21',
        pdfPath: `pdfs/${filename}`,
      },
    })

    // If GET /:id/pdf still read bank.pdfPassword raw (the enc:v1: ciphertext)
    // instead of decrypting it first, decryptPdf would be handed the wrong
    // password and this would 404 (caught by the route's catch-all).
    const res = await app.request(`/api/bills/${bill.id}/pdf`, { headers: { Cookie: boss } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
  })
})

describe('bills: GET /:id/pdf surfaces an ENCRYPTION_KEY misconfiguration instead of a misleading 404', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it('bank.pdfPassword stored as enc:v1: ciphertext but ENCRYPTION_KEY unset at read time returns 500 with the misconfiguration message, not a 404', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })

    // Produce genuine enc:v1: ciphertext the way routes/banks.ts's write path
    // would, using a key that is then removed — simulates ENCRYPTION_KEY
    // going missing/rotated while encrypted data still sits in the DB.
    process.env.ENCRYPTION_KEY = 'misconfig-test-key-then-removed'
    const ciphertext = encryptSecret('WouldHaveBeenDecryptedPass')
    delete process.env.ENCRYPTION_KEY

    const bank = await prisma.bank.create({
      data: {
        name: 'PDF Fixture Bank (misconfigured encryption)',
        emailSenderPattern: 'pdf-misconf@pdf',
        emailSubjectPattern: 'pdf-misconf',
        pdfPassword: ciphertext,
        userId: bossUser!.id,
      },
    })

    fs.mkdirSync(PDF_DIR, { recursive: true })
    const filename = `${bank.id}_fixture.pdf`
    // Content is irrelevant: getBankPdfPassword throws (evaluated as decryptPdf's
    // argument) before decryptPdf's body ever runs, as long as the file exists so
    // fs.readFile succeeds first and the throw is attributable to the misconfig.
    fs.writeFileSync(path.join(PDF_DIR, filename), Buffer.from('placeholder, never read'))

    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-07',
        amount: 777,
        dueDate: '2026-07-23',
        pdfPath: `pdfs/${filename}`,
      },
    })

    const res = await app.request(`/api/bills/${bill.id}/pdf`, { headers: { Cookie: boss } })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('ENCRYPTION_KEY')
  })
})
