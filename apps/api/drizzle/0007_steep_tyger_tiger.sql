DROP TABLE "kyc_submissions" CASCADE;--> statement-breakpoint
DELETE FROM "wallet_documents" WHERE "kind" IN ('nid_front', 'nid_back');--> statement-breakpoint
ALTER TABLE "wallet_documents" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."wallet_document_kind";--> statement-breakpoint
CREATE TYPE "public"."wallet_document_kind" AS ENUM('manual_deposit_proof');--> statement-breakpoint
ALTER TABLE "wallet_documents" ALTER COLUMN "kind" SET DATA TYPE "public"."wallet_document_kind" USING "kind"::"public"."wallet_document_kind";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "kyc_status";--> statement-breakpoint
DROP TYPE "public"."kyc_status";
