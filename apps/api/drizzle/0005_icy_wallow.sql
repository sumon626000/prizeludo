CREATE TYPE "public"."transaction_direction" AS ENUM('none', 'incoming', 'outgoing');--> statement-breakpoint
ALTER TYPE "public"."otp_purpose" ADD VALUE 'profile_phone_change';--> statement-breakpoint
ALTER TYPE "public"."transaction_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."transaction_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."transaction_status" ADD VALUE 'paid';--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "finish_position" integer;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "prize_earned" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "method" varchar(80);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "direction" "transaction_direction" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_user_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_tournament_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bonus_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "commission_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_user_id_users_id_fk" FOREIGN KEY ("related_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_tournament_id_tournaments_id_fk" FOREIGN KEY ("related_tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_related_user_idx" ON "transactions" USING btree ("related_user_id");--> statement-breakpoint
CREATE INDEX "transactions_related_tournament_idx" ON "transactions" USING btree ("related_tournament_id");--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_finish_position_check" CHECK ("tournament_entries"."finish_position" is null or "tournament_entries"."finish_position" > 0);--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_prize_nonnegative" CHECK ("tournament_entries"."prize_earned" >= 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bonus_nonnegative" CHECK ("transactions"."bonus_amount" >= 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_commission_nonnegative" CHECK ("transactions"."commission_amount" >= 0);