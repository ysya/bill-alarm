-- AlterTable
ALTER TABLE "bills" ADD COLUMN "pdfPath" TEXT;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_banks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "emailSenderPattern" TEXT NOT NULL,
    "emailSubjectPattern" TEXT NOT NULL,
    "pdfPassword" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoDebit" BOOLEAN NOT NULL DEFAULT false,
    "bankAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "banks_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_banks" ("code", "createdAt", "emailSenderPattern", "emailSubjectPattern", "id", "isActive", "isBuiltin", "name", "pdfPassword", "updatedAt") SELECT "code", "createdAt", "emailSenderPattern", "emailSubjectPattern", "id", "isActive", "isBuiltin", "name", "pdfPassword", "updatedAt" FROM "banks";
DROP TABLE "banks";
ALTER TABLE "new_banks" RENAME TO "banks";
CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
