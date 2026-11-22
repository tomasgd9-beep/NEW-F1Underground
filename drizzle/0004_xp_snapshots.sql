CREATE TABLE "job_state" (
	"key" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"name" text NOT NULL,
	"xp" jsonb NOT NULL,
	"hash" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xp_snapshots" ADD CONSTRAINT "xp_snapshots_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_snapshots_race" ON "xp_snapshots" USING btree ("race_id","captured_at");