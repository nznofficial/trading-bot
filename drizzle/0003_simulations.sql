CREATE TABLE "simulations" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"params" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"bars" integer NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "simulations_created_idx" ON "simulations" USING btree ("created_at");