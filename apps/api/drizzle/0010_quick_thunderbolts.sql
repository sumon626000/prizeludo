ALTER TABLE "bot_players" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "use_global_win_rate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "action_delay_min_ms" integer DEFAULT 900 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_players" ADD COLUMN "action_delay_max_ms" integer DEFAULT 2200 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_players_user_unique" ON "bot_players" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_action_delay_check" CHECK ("bot_players"."action_delay_min_ms" between 500 and 5000 and "bot_players"."action_delay_max_ms" between "bot_players"."action_delay_min_ms" and 10000);