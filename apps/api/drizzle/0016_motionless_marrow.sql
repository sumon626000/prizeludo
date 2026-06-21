CREATE UNIQUE INDEX "brackets_player_round_unique" ON "brackets" USING btree ("tournament_id","round","player_id") WHERE "brackets"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_reference_unique" ON "transactions" USING btree ("reference") WHERE "transactions"."reference" is not null;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_round_positive" CHECK ("brackets"."round" > 0);--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_position_positive" CHECK ("brackets"."position" > 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_positive" CHECK ("matches"."round" > 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_distinct_placements" CHECK ("matches"."winner_id" is null or "matches"."runner_up_id" is null or "matches"."winner_id" <> "matches"."runner_up_id");