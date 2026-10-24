CREATE TABLE "chat_counters" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_counters_expires_idx" ON "chat_counters" USING btree ("expires_at");