-- Defensive backfill: protects any row created by hand between migrations
UPDATE "banks" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "bank_accounts" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "notification_rules" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "scan_logs" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bank_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bank_accounts" ("bankName", "createdAt", "id", "name", "note", "updatedAt", "userId") SELECT "bankName", "createdAt", "id", "name", "note", "updatedAt", "userId" FROM "bank_accounts";
DROP TABLE "bank_accounts";
ALTER TABLE "new_bank_accounts" RENAME TO "bank_accounts";
CREATE TABLE "new_banks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "emailSenderPattern" TEXT NOT NULL,
    "emailSubjectPattern" TEXT NOT NULL,
    "pdfPassword" TEXT,
    "parserConfig" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoDebit" BOOLEAN NOT NULL DEFAULT false,
    "bankAccountId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "banks_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "banks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_banks" ("autoDebit", "bankAccountId", "code", "createdAt", "emailSenderPattern", "emailSubjectPattern", "id", "isActive", "isBuiltin", "name", "parserConfig", "pdfPassword", "updatedAt", "userId") SELECT "autoDebit", "bankAccountId", "code", "createdAt", "emailSenderPattern", "emailSubjectPattern", "id", "isActive", "isBuiltin", "name", "parserConfig", "pdfPassword", "updatedAt", "userId" FROM "banks";
DROP TABLE "banks";
ALTER TABLE "new_banks" RENAME TO "banks";
CREATE UNIQUE INDEX "banks_userId_code_key" ON "banks"("userId", "code");
CREATE TABLE "new_notification_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "notification_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_rules" ("channels", "createdAt", "daysBefore", "id", "isActive", "name", "timeOfDay", "updatedAt", "userId") SELECT "channels", "createdAt", "daysBefore", "id", "isActive", "name", "timeOfDay", "updatedAt", "userId" FROM "notification_rules";
DROP TABLE "notification_rules";
ALTER TABLE "new_notification_rules" RENAME TO "notification_rules";
CREATE TABLE "new_scan_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "newBillsCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "fatalError" TEXT,
    CONSTRAINT "scan_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_scan_logs" ("errorCount", "errors", "fatalError", "finishedAt", "id", "newBillsCount", "scanned", "startedAt", "trigger", "userId") SELECT "errorCount", "errors", "fatalError", "finishedAt", "id", "newBillsCount", "scanned", "startedAt", "trigger", "userId" FROM "scan_logs";
DROP TABLE "scan_logs";
ALTER TABLE "new_scan_logs" RENAME TO "scan_logs";
CREATE INDEX "scan_logs_startedAt_idx" ON "scan_logs"("startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
