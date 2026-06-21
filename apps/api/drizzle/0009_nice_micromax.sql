CREATE TABLE "game_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" varchar(20) NOT NULL,
	"content" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_messages_kind_check" CHECK ("game_messages"."kind" in ('chat', 'emoji', 'system'))
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "miss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "disconnected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "reconnect_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_messages_match_created_idx" ON "game_messages" USING btree ("match_id","created_at");--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_miss_nonnegative" CHECK ("match_players"."miss_count" >= 0);