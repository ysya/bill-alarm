ALTER TABLE "bills" ADD COLUMN "transferredAmount" INTEGER;

-- Earlier versions stored only the transfer date. The bill's current amount
-- is the only estimate available for those historical transfers.
UPDATE "bills" SET "transferredAmount" = "amount" WHERE "transferredAt" IS NOT NULL;
