-- CreateTable
CREATE TABLE "scan_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "newBillsCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "fatalError" TEXT
);

-- CreateIndex
CREATE INDEX "scan_logs_startedAt_idx" ON "scan_logs"("startedAt");
