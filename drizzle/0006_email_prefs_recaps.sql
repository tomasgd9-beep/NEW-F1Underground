CREATE TABLE "email_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"all_off" boolean DEFAULT false NOT NULL,
	"reminders" boolean DEFAULT true NOT NULL,
	"recaps" boolean DEFAULT true NOT NULL,
	"announcements" boolean DEFAULT true NOT NULL,
	"commissioner" boolean DEFAULT true NOT NULL,
	"token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_prefs_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "recaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_prefs" ADD CONSTRAINT "email_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recaps_league_race" ON "recaps" USING btree ("league_id","race_id");