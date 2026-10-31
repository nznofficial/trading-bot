CREATE TABLE "news_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" integer,
	"news_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text,
	"detail" text NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"headline" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"symbols" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_scores" (
	"news_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sentiment" double precision NOT NULL,
	"materiality" double precision NOT NULL,
	"category" text NOT NULL,
	"rationale" text NOT NULL,
	"model" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_scores_news_id_symbol_pk" PRIMARY KEY("news_id","symbol")
);
--> statement-breakpoint
CREATE INDEX "news_actions_ts_idx" ON "news_actions" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "news_actions_dedupe_idx" ON "news_actions" USING btree ("news_id","symbol","kind");--> statement-breakpoint
CREATE INDEX "news_items_created_idx" ON "news_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "news_scores_symbol_created_idx" ON "news_scores" USING btree ("symbol","created_at");