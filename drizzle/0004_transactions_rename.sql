ALTER TABLE "qris" RENAME TO "transactions";
ALTER TABLE "claims" RENAME COLUMN "qris_id" TO "transaction_id";
