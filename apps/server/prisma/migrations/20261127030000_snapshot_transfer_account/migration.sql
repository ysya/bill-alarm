ALTER TABLE "bills" ADD COLUMN "transferredAccountId" TEXT;

UPDATE "bills"
SET "transferredAccountId" = (SELECT "bankAccountId" FROM "banks" WHERE "banks"."id" = "bills"."bankId")
WHERE "transferredAt" IS NOT NULL;
