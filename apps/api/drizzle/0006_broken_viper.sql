CREATE TYPE "public"."balance_source" AS ENUM('none', 'main', 'winner');--> statement-breakpoint
CREATE TYPE "public"."wallet_document_kind" AS ENUM('manual_deposit_proof', 'nid_front', 'nid_back');--> statement-breakpoint
CREATE TABLE "deposit_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"bonus_percent" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_offers_amount_positive" CHECK ("deposit_offers"."amount" > 0),
	CONSTRAINT "deposit_offers_bonus_range" CHECK ("deposit_offers"."bonus_percent" between 0 and 100),
	CONSTRAINT "deposit_offers_sort_nonnegative" CHECK ("deposit_offers"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" varchar(20) NOT NULL,
	"nid_encrypted" text NOT NULL,
	"nid_last_four" varchar(4) NOT NULL,
	"nid_front_document_id" uuid NOT NULL,
	"nid_back_document_id" uuid,
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_submissions_nid_last_four_check" CHECK ("kyc_submissions"."nid_last_four" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "wallet_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "wallet_document_kind" NOT NULL,
	"mime_type" varchar(40) NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_documents_size_check" CHECK ("wallet_documents"."byte_size" between 1 and 5242880)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_document_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider" varchar(40);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider_invoice_id" varchar(160);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "balance_source" "balance_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "balance_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_nid_front_document_id_wallet_documents_id_fk" FOREIGN KEY ("nid_front_document_id") REFERENCES "public"."wallet_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_nid_back_document_id_wallet_documents_id_fk" FOREIGN KEY ("nid_back_document_id") REFERENCES "public"."wallet_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_documents" ADD CONSTRAINT "wallet_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_offers_amount_unique" ON "deposit_offers" USING btree ("amount");--> statement-breakpoint
CREATE INDEX "deposit_offers_active_sort_idx" ON "deposit_offers" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "kyc_submissions_user_created_idx" ON "kyc_submissions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_submissions_pending_user_unique" ON "kyc_submissions" USING btree ("user_id") WHERE "kyc_submissions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "wallet_documents_user_kind_idx" ON "wallet_documents" USING btree ("user_id","kind");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_document_id_wallet_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."wallet_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_related_document_idx" ON "transactions" USING btree ("related_document_id");--> statement-breakpoint
CREATE INDEX "transactions_group_idx" ON "transactions" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_invoice_unique" ON "transactions" USING btree ("provider","provider_invoice_id");