ALTER TABLE "recaps" ADD COLUMN "skip_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Races already final when automatic recaps start are not emailed by the job (a commissioner can still send them).
INSERT INTO "recaps" ("league_id", "race_id", "skip_auto")
SELECT l.id, r.id, true FROM "leagues" l CROSS JOIN "races" r WHERE r.results = 'final'
ON CONFLICT ("league_id", "race_id") DO UPDATE SET "skip_auto" = true;
