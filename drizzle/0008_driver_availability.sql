CREATE TABLE "asset_outs" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer,
	"constructor_id" integer,
	"race_id" integer,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_outs_one_asset" CHECK (("asset_outs"."person_id" is null) <> ("asset_outs"."constructor_id" is null))
);
--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "closed_by_hand" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_outs" ADD CONSTRAINT "asset_outs_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_outs" ADD CONSTRAINT "asset_outs_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_outs" ADD CONSTRAINT "asset_outs_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;