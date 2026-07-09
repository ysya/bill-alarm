/*
  Warnings:

  - You are about to drop the column `calendarEventId` on the `bills` table. All the data in the column will be lost.

*/
-- dueDate: DateTime -> 'YYYY-MM-DD' TEXT. Historic rows were written as UTC
-- midnight (parser/LLM) or Taipei-midnight-in-UTC (frontend edits); shifting
-- +8h before taking the date yields the intended Taipei calendar date for all.
-- Probed storage format is ISO-8601 TEXT (e.g. '2026-07-10T00:00:00.000+00:00'),
-- so SQL-A applies: date(datetime("dueDate", '+8 hours')).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankId" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "minimumPayment" INTEGER,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "parseSource" TEXT,
    "paidAt" DATETIME,
    "sourceEmailId" TEXT,
    "rawEmailSnippet" TEXT,
    "pdfPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bills_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bills" ("amount", "bankId", "billingPeriod", "createdAt", "dueDate", "id", "minimumPayment", "paidAt", "parseSource", "pdfPath", "rawEmailSnippet", "sourceEmailId", "status", "updatedAt") SELECT "amount", "bankId", "billingPeriod", "createdAt", date(datetime("dueDate", '+8 hours')), "id", "minimumPayment", "paidAt", "parseSource", "pdfPath", "rawEmailSnippet", "sourceEmailId", "status", "updatedAt" FROM "bills";
DROP TABLE "bills";
ALTER TABLE "new_bills" RENAME TO "bills";
CREATE INDEX "bills_status_dueDate_idx" ON "bills"("status", "dueDate");
CREATE INDEX "bills_bankId_idx" ON "bills"("bankId");
CREATE UNIQUE INDEX "bills_bankId_billingPeriod_key" ON "bills"("bankId", "billingPeriod");
CREATE TABLE "new_notification_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "ruleId" TEXT,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_logs_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "notification_rules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_notification_logs" ("billId", "channel", "errorMessage", "id", "message", "ruleId", "sentAt", "success") SELECT "billId", "channel", "errorMessage", "id", "message", "ruleId", "sentAt", "success" FROM "notification_logs";
DROP TABLE "notification_logs";
ALTER TABLE "new_notification_logs" RENAME TO "notification_logs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
