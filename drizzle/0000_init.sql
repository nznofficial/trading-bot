CREATE TABLE "benchmark_bars" (
	"date" text PRIMARY KEY NOT NULL,
	"close" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"market_open" boolean,
	"signals" integer DEFAULT 0 NOT NULL,
	"orders_placed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"message" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"equity" double precision NOT NULL,
	"last_equity" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"buying_power" double precision NOT NULL,
	"long_market_value" double precision NOT NULL,
	"market_open" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" double precision NOT NULL,
	"price" double precision NOT NULL,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"client_order_id" text NOT NULL,
	"parent_id" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" double precision,
	"filled_qty" double precision DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"order_class" text,
	"status" text NOT NULL,
	"strategy" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"filled_at" timestamp with time zone,
	"filled_avg_price" double precision,
	"stop_price" double precision,
	"limit_price" double precision
);
--> statement-breakpoint
CREATE TABLE "positions_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"symbol" text NOT NULL,
	"qty" double precision NOT NULL,
	"avg_entry" double precision NOT NULL,
	"current_price" double precision NOT NULL,
	"market_value" double precision NOT NULL,
	"unrealized_pl" double precision NOT NULL,
	"unrealized_plpc" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"bar_ts" timestamp with time zone NOT NULL,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"indicators" jsonb NOT NULL,
	"acted" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "equity_snapshots_ts_idx" ON "equity_snapshots" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "fills_ts_idx" ON "fills" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "orders_submitted_idx" ON "orders" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "positions_snapshot_run_idx" ON "positions_snapshot" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "signals_ts_idx" ON "signals" USING btree ("ts");