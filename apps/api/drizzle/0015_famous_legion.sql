ALTER TABLE "tournament_entries" ADD COLUMN "paid_main_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "paid_winner_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "tournament_entries"
SET "paid_main_amount" = "paid_amount"
WHERE "paid_amount" > 0 AND "balance_source" <> 'winner';--> statement-breakpoint
UPDATE "tournament_entries"
SET "paid_winner_amount" = "paid_amount"
WHERE "paid_amount" > 0 AND "balance_source" = 'winner';--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_paid_main_nonnegative" CHECK ("tournament_entries"."paid_main_amount" >= 0);--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_paid_winner_nonnegative" CHECK ("tournament_entries"."paid_winner_amount" >= 0);
