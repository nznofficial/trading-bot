CREATE TABLE "benchmark_closes" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"close" double precision NOT NULL,
	CONSTRAINT "benchmark_closes_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "fees" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"asset_class" text DEFAULT 'us_equity' NOT NULL,
	"order_id" text,
	"amount_usd" double precision NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "asset_class" text DEFAULT 'us_equity' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "asset_class" text DEFAULT 'us_equity' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions_snapshot" ADD COLUMN "asset_class" text DEFAULT 'us_equity' NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "asset_class" text DEFAULT 'us_equity' NOT NULL;--> statement-breakpoint
CREATE INDEX "fees_ts_idx" ON "fees" USING btree ("ts");