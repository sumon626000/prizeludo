ALTER TABLE "bot_players" ADD CONSTRAINT "bot_players_win_rate_check" CHECK ("bot_players"."win_rate" between 1 and 100);--> statement-breakpoint
ALTER TABLE "game_states" ADD CONSTRAINT "game_states_dice_check" CHECK ("game_states"."dice_value" is null or "game_states"."dice_value" between 1 and 6);--> statement-breakpoint
ALTER TABLE "game_states" ADD CONSTRAINT "game_states_version_nonnegative" CHECK ("game_states"."state_version" >= 0);--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_seat_check" CHECK ("match_players"."seat" between 1 and 4);--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_reconnect_nonnegative" CHECK ("match_players"."reconnect_count" >= 0);--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_attempts_nonnegative" CHECK ("otp_challenges"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_player_count_check" CHECK ("tournaments"."player_count" in (2, 4, 8, 16, 32, 64));--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_join_fee_nonnegative" CHECK ("tournaments"."join_fee" >= 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_prize_pool_nonnegative" CHECK ("tournaments"."prize_pool" >= 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_commission_range" CHECK ("tournaments"."admin_commission" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_prize_first_range" CHECK ("tournaments"."prize_first" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_prize_second_range" CHECK ("tournaments"."prize_second" between 0 and 100);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_game_id_format_check" CHECK ("users"."game_id" ~ '^[0-9]{5}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_main_balance_nonnegative" CHECK ("users"."main_balance" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_winner_balance_nonnegative" CHECK ("users"."winner_balance" >= 0);