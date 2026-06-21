ALTER TYPE "public"."transaction_type" ADD VALUE 'tournament_fee';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'tournament_refund';--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "placement" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "runner_up_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ready_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "current_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "total_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "between_round_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "next_round_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "collected_fees" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "admin_revenue" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_runner_up_id_users_id_fk" FOREIGN KEY ("runner_up_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_placement_check" CHECK ("match_players"."placement" is null or "match_players"."placement" between 1 and 4);--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_paid_nonnegative" CHECK ("tournament_entries"."paid_amount" >= 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_prize_split_check" CHECK ("tournaments"."prize_first" + "tournaments"."prize_second" = 100);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_countdown_duration_check" CHECK ("tournaments"."countdown_duration" between 10 and 86400);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_between_round_check" CHECK ("tournaments"."between_round_seconds" between 30 and 60);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_rounds_nonnegative" CHECK ("tournaments"."current_round" >= 0 and "tournaments"."total_rounds" >= 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_accounting_nonnegative" CHECK ("tournaments"."collected_fees" >= 0 and "tournaments"."admin_revenue" >= 0);