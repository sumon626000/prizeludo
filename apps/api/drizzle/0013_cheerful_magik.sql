DROP TABLE "otp_challenges" CASCADE;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "balance_source" "balance_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
UPDATE "tournament_entries" SET "balance_source" = 'main' WHERE "paid_amount" > 0;--> statement-breakpoint
DROP TYPE "public"."otp_purpose";
