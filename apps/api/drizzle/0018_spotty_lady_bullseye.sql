ALTER TABLE "tournaments" ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "recurring_template_key" varchar(80);--> statement-breakpoint
CREATE INDEX "tournaments_recurring_template_idx" ON "tournaments" USING btree ("recurring_template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_recurring_waiting_unique" ON "tournaments" USING btree ("recurring_template_key") WHERE "tournaments"."is_recurring" = true and "tournaments"."status" in ('upcoming', 'waiting');--> statement-breakpoint

INSERT INTO "transactions" (
  "user_id", "type", "amount", "status", "reference", "balance_source",
  "balance_applied_at", "related_tournament_id", "metadata"
)
SELECT
  te."user_id", 'tournament_refund', te."paid_main_amount", 'success',
  'cleanup-refund-main-' || te."id", 'main', now(), te."tournament_id",
  jsonb_build_object('reason', 'production recurring tournament reset')
FROM "tournament_entries" te
INNER JOIN "tournaments" t ON t."id" = te."tournament_id"
WHERE t."status" <> 'completed' AND te."paid_main_amount" > 0
ON CONFLICT ("reference") WHERE "reference" IS NOT NULL DO NOTHING;--> statement-breakpoint

INSERT INTO "transactions" (
  "user_id", "type", "amount", "status", "reference", "balance_source",
  "balance_applied_at", "related_tournament_id", "metadata"
)
SELECT
  te."user_id", 'tournament_refund', te."paid_winner_amount", 'success',
  'cleanup-refund-winner-' || te."id", 'winner', now(), te."tournament_id",
  jsonb_build_object('reason', 'production recurring tournament reset')
FROM "tournament_entries" te
INNER JOIN "tournaments" t ON t."id" = te."tournament_id"
WHERE t."status" <> 'completed' AND te."paid_winner_amount" > 0
ON CONFLICT ("reference") WHERE "reference" IS NOT NULL DO NOTHING;--> statement-breakpoint

UPDATE "users" u
SET
  "main_balance" = u."main_balance" + refunds."main_refund",
  "winner_balance" = u."winner_balance" + refunds."winner_refund",
  "updated_at" = now()
FROM (
  SELECT
    te."user_id",
    coalesce(sum(te."paid_main_amount"), 0) AS "main_refund",
    coalesce(sum(te."paid_winner_amount"), 0) AS "winner_refund"
  FROM "tournament_entries" te
  INNER JOIN "tournaments" t ON t."id" = te."tournament_id"
  WHERE t."status" <> 'completed'
  GROUP BY te."user_id"
) refunds
WHERE u."id" = refunds."user_id";--> statement-breakpoint

DELETE FROM "tournaments" WHERE "status" <> 'completed';--> statement-breakpoint

INSERT INTO "settings" ("key", "value", "updated_at")
VALUES
  ('tournament.showcase_enabled', 'false', now()),
  ('tournament.recurring_full_countdown_seconds', '300', now())
ON CONFLICT ("key") DO UPDATE
SET "value" = excluded."value", "updated_at" = excluded."updated_at";
