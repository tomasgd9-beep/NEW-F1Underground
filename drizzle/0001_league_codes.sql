CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"code_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- The existing league: everyone already in the database belongs to it.
INSERT INTO "leagues" ("name", "code") SELECT 'F1 Underground', string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31)::int + 1, 1), '') FROM generate_series(1, 6);--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT "players_user_id_unique";--> statement-breakpoint
DROP INDEX "players_display_name";--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "league_id" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "league_id" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "league_id" integer;--> statement-breakpoint
UPDATE "invites" SET "league_id" = (SELECT min("id") FROM "leagues");--> statement-breakpoint
UPDATE "players" SET "league_id" = (SELECT min("id") FROM "leagues");--> statement-breakpoint
UPDATE "activity_log" SET "league_id" = (SELECT min("id") FROM "leagues") WHERE "actor" <> 'job';--> statement-breakpoint
-- Old shareable join links are replaced by the league code.
UPDATE "invites" SET "active" = false WHERE "kind" = 'link';--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "league_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "league_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_league_user" ON "players" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_display_name" ON "players" USING btree ("league_id",lower("display_name"));