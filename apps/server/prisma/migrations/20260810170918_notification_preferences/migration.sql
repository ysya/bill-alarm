/*
  Warnings:

  - You are about to drop the `notification_rules` table. Its data is converted
    into `notification_preferences` (see the INSERT below) before the drop.
  - You are about to drop the column `ruleId` on the `notification_logs` table.

*/
-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "remindDays" TEXT NOT NULL DEFAULT '[3,1]',
    "remindTime" TEXT NOT NULL DEFAULT '09:00',
    "notifyNewBill" BOOLEAN NOT NULL DEFAULT true,
    "notifyOverdue" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- Data conversion: materialize prefs only for users who have at least one rule.
-- remindDays = DISTINCT active daysBefore (order irrelevant — readers normalize),
-- remindTime = earliest active timeOfDay; users with only inactive rules get '[]'
-- (they deliberately switched reminders off). Users with no rules at all get no
-- row: every reader falls back to the shared defaults.
INSERT INTO "notification_preferences" ("id","userId","remindDays","remindTime","createdAt","updatedAt")
SELECT
    lower(hex(randomblob(16))),
    u."id",
    COALESCE((
        SELECT '[' || group_concat(DISTINCT r."daysBefore") || ']'
        FROM "notification_rules" r
        WHERE r."userId" = u."id" AND r."isActive" = 1
    ), '[]'),
    COALESCE((
        SELECT MIN(r."timeOfDay") FROM "notification_rules" r
        WHERE r."userId" = u."id" AND r."isActive" = 1
    ), '09:00'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "notification_rules" r WHERE r."userId" = u."id");

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "notification_rules";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_notification_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_logs_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_logs" ("billId", "channel", "errorMessage", "id", "message", "sentAt", "success") SELECT "billId", "channel", "errorMessage", "id", "message", "sentAt", "success" FROM "notification_logs";
DROP TABLE "notification_logs";
ALTER TABLE "new_notification_logs" RENAME TO "notification_logs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
