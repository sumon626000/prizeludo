CREATE TYPE "public"."tournament_entry_status" AS ENUM('pre_registered', 'joined', 'left', 'eliminated');--> statement-breakpoint
CREATE TABLE "promotional_wins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_player_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"is_disclosed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotional_wins_amount_positive" CHECK ("promotional_wins"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "tournament_entry_status" DEFAULT 'pre_registered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "total_earnings" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "countdown_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotional_wins" ADD CONSTRAINT "promotional_wins_bot_player_id_bot_players_id_fk" FOREIGN KEY ("bot_player_id") REFERENCES "public"."bot_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotional_wins_created_idx" ON "promotional_wins" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_entries_user_unique" ON "tournament_entries" USING btree ("tournament_id","user_id");--> statement-breakpoint
CREATE INDEX "tournament_entries_tournament_status_idx" ON "tournament_entries" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "tournament_entries_user_status_idx" ON "tournament_entries" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_wins_nonnegative" CHECK ("bot_players"."wins" >= 0);--> statement-breakpoint
ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_losses_nonnegative" CHECK ("bot_players"."losses" >= 0);--> statement-breakpoint
ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_earnings_nonnegative" CHECK ("bot_players"."total_earnings" >= 0);