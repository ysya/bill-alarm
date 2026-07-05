-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "telegramChatId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Data migration: promote the legacy single-user credentials (settings table)
-- to the admin user. The legacy telegram chat id becomes the admin's binding.
INSERT INTO "users" ("id", "username", "passwordHash", "role", "telegramChatId", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    (SELECT "value" FROM "settings" WHERE "key" = 'auth_username'),
    (SELECT "value" FROM "settings" WHERE "key" = 'auth_password_hash'),
    'admin',
    (SELECT "value" FROM "settings" WHERE "key" = 'telegram_chat_id'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'auth_username')
  AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'auth_password_hash');

DELETE FROM "settings" WHERE "key" IN ('auth_username', 'auth_password_hash', 'telegram_chat_id');

-- Sessions are wiped (everyone re-logs-in once) and rebuilt with a required userId FK.
DROP TABLE "sessions";
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastExtendedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
