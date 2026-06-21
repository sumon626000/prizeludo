ALTER TABLE "users" ADD COLUMN "username" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");