CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "game_messages_created_idx" ON "game_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_read_created_idx" ON "notifications" USING btree ("is_read","created_at");