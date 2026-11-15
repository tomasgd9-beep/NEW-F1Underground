CREATE TYPE "public"."invite_kind" AS ENUM('link', 'email');--> statement-breakpoint
CREATE TYPE "public"."pick_origin" AS ENUM('manual', 'random', 'auto_filled');--> statement-breakpoint
CREATE TYPE "public"."player_role" AS ENUM('player', 'commissioner');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('scheduled', 'delayed', 'cancelled', 'relocated', 'completed');--> statement-breakpoint
CREATE TYPE "public"."results_state" AS ENUM('none', 'live', 'provisional', 'final');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('upcoming', 'active', 'finished');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"result" text DEFAULT 'ok' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"stint_id" integer,
	"constructor_id" integer,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sprint_total" numeric(7, 1),
	"quali_total" numeric(7, 1),
	"race_total" numeric(7, 1),
	"total" numeric(7, 1),
	"is_final" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_points_one_asset" CHECK (("asset_points"."stint_id" is null) <> ("asset_points"."constructor_id" is null))
);
--> statement-breakpoint
CREATE TABLE "asset_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"person_id" integer,
	"constructor_id" integer,
	"last_season_price" numeric(7, 2),
	"last3" numeric(7, 1),
	"races_counted" integer,
	"formula_price" numeric(7, 2),
	"override_price" numeric(7, 2),
	"final_price" numeric(7, 2) NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "asset_prices_one_asset" CHECK (("asset_prices"."person_id" is null) <> ("asset_prices"."constructor_id" is null))
);
--> statement-breakpoint
CREATE TABLE "constructors" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"colour" text DEFAULT '#888888' NOT NULL,
	"fft_id" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "constructors_ticker_unique" UNIQUE("ticker"),
	CONSTRAINT "constructors_fft_id_unique" UNIQUE("fft_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "invite_kind" NOT NULL,
	"token" text NOT NULL,
	"email" text,
	"invited_by_user_id" text,
	"used_by_user_id" text,
	"used_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"full_name" text NOT NULL,
	CONSTRAINT "people_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"double_stint_id" integer,
	"driver1_stint_id" integer,
	"driver2_stint_id" integer,
	"driver3_stint_id" integer,
	"driver4_stint_id" integer,
	"constructor_id" integer,
	"frozen_team_price" numeric(7, 2),
	"penalty" integer,
	"origin" "pick_origin" DEFAULT 'manual' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"user_id" text,
	"claim_requested_by" text,
	"role" "player_role" DEFAULT 'player' NOT NULL,
	"joined_at_race_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "players_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "price_peers" (
	"person_id" integer PRIMARY KEY NOT NULL,
	"peer_person_id" integer NOT NULL,
	"season_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"round" integer NOT NULL,
	"label" text NOT NULL,
	"fft_id" text,
	"name" text NOT NULL,
	"country" text,
	"is_sprint" boolean DEFAULT false NOT NULL,
	"status" "race_status" DEFAULT 'scheduled' NOT NULL,
	"session_times" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deadline" timestamp with time zone,
	"deadline_manual" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"results" "results_state" DEFAULT 'none' NOT NULL,
	CONSTRAINT "races_fft_id_unique" UNIQUE("fft_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"type" text DEFAULT '24h' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"budget" numeric(6, 2) DEFAULT '100' NOT NULL,
	"double_cap" numeric(6, 2) DEFAULT '20' NOT NULL,
	"status" "season_status" DEFAULT 'upcoming' NOT NULL,
	CONSTRAINT "seasons_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stints" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"constructor_id" integer NOT NULL,
	"first_race_id" integer,
	"last_race_id" integer,
	"fft_id" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stints_fft_id_unique" UNIQUE("fft_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_points" ADD CONSTRAINT "asset_points_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_points" ADD CONSTRAINT "asset_points_stint_id_stints_id_fk" FOREIGN KEY ("stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_points" ADD CONSTRAINT "asset_points_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_double_stint_id_stints_id_fk" FOREIGN KEY ("double_stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_driver1_stint_id_stints_id_fk" FOREIGN KEY ("driver1_stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_driver2_stint_id_stints_id_fk" FOREIGN KEY ("driver2_stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_driver3_stint_id_stints_id_fk" FOREIGN KEY ("driver3_stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_driver4_stint_id_stints_id_fk" FOREIGN KEY ("driver4_stint_id") REFERENCES "public"."stints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_claim_requested_by_users_id_fk" FOREIGN KEY ("claim_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_joined_at_race_id_races_id_fk" FOREIGN KEY ("joined_at_race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_peers" ADD CONSTRAINT "price_peers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_peers" ADD CONSTRAINT "price_peers_peer_person_id_people_id_fk" FOREIGN KEY ("peer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_peers" ADD CONSTRAINT "price_peers_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_first_race_id_races_id_fk" FOREIGN KEY ("first_race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_last_race_id_races_id_fk" FOREIGN KEY ("last_race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_points_stint_race" ON "asset_points" USING btree ("race_id","stint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_points_constructor_race" ON "asset_points" USING btree ("race_id","constructor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_prices_person_race" ON "asset_prices" USING btree ("race_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_prices_constructor_race" ON "asset_prices" USING btree ("race_id","constructor_id");--> statement-breakpoint
CREATE INDEX "invites_email" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_player_race" ON "picks" USING btree ("player_id","race_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_display_name" ON "players" USING btree (lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "races_season_round" ON "races" USING btree ("season_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_once" ON "reminders" USING btree ("player_id","race_id","type");