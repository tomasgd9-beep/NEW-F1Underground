// F1 Underground data model. Everything is a record (never a column position),
// so a new race, driver or season is one more row and nothing shifts.
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

/* ───────────────────────────── Enums ───────────────────────────── */

export const seasonStatus = pgEnum("season_status", ["upcoming", "active", "finished"]);
export const raceStatus = pgEnum("race_status", [
  "scheduled",
  "delayed",
  "cancelled",
  "relocated",
  "completed",
]);
export const resultsState = pgEnum("results_state", ["none", "live", "provisional", "final"]);
export const playerRole = pgEnum("player_role", ["player", "commissioner"]);
export const pickOrigin = pgEnum("pick_origin", ["manual", "random", "auto_filled"]);
export const inviteKind = pgEnum("invite_kind", ["link", "email"]);

/* ─────────────────────── Auth.js tables (adapter) ─────────────────────── */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ───────────────────────────── League ───────────────────────────── */

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull().unique(),
  budget: numeric("budget", { precision: 6, scale: 2 }).notNull().default("100"),
  doubleCap: numeric("double_cap", { precision: 6, scale: 2 }).notNull().default("20"),
  status: seasonStatus("status").notNull().default("upcoming"),
});

export const races = pgTable(
  "races",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id),
    round: integer("round").notNull(),
    /** Short label used across the app, e.g. "R23 VEG". */
    label: text("label").notNull(),
    /** f1fantasytools race id, e.g. "2026_21". */
    fftId: text("fft_id").unique(),
    name: text("name").notNull(),
    country: text("country"),
    isSprint: boolean("is_sprint").notNull().default(false),
    status: raceStatus("status").notNull().default("scheduled"),
    /** Session start times keyed by session ("sprint", "qualifying", "race", ...). ISO strings. */
    sessionTimes: jsonb("session_times").$type<Record<string, string>>().notNull().default({}),
    /** Start of the first points-scoring session. */
    deadline: timestamp("deadline", { mode: "date", withTimezone: true }),
    /** True once a commissioner has set the deadline by hand (the sync job then leaves it alone). */
    deadlineManual: boolean("deadline_manual").notNull().default(false),
    lockedAt: timestamp("locked_at", { mode: "date", withTimezone: true }),
    results: resultsState("results").notNull().default("none"),
  },
  (t) => [uniqueIndex("races_season_round").on(t.seasonId, t.round)],
);

/** A real driver. Season, Last 3, Races and price belong here (summed across stints). */
export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(), // e.g. "LAW"
  fullName: text("full_name").notNull(),
});

export const constructors = pgTable("constructors", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(), // e.g. "RED"
  name: text("name").notNull(),
  /** Hex colour for the asset stripe; commissioner-editable. */
  colour: text("colour").notNull().default("#888888"),
  /** f1fantasytools constructor id. */
  fftId: text("fft_id").unique(),
  active: boolean("active").notNull().default(true),
});

/** A driver at a team for a span of races. Race points belong to the stint. */
export const stints = pgTable("stints", {
  id: serial("id").primaryKey(),
  personId: integer("person_id")
    .notNull()
    .references(() => people.id),
  constructorId: integer("constructor_id")
    .notNull()
    .references(() => constructors.id),
  firstRaceId: integer("first_race_id").references(() => races.id),
  /** Empty = current stint. */
  lastRaceId: integer("last_race_id").references(() => races.id),
  /** f1fantasytools asset key, e.g. "HAA_CAM". */
  fftId: text("fft_id").unique(),
  active: boolean("active").notNull().default(true),
});

/** Points for one asset (stint or constructor) at one race. */
export const assetPoints = pgTable(
  "asset_points",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    stintId: integer("stint_id").references(() => stints.id),
    constructorId: integer("constructor_id").references(() => constructors.id),
    /** Every session field (position, gained, overtakes, fastest lap, DotD/pit, Q2/Q3 bonus...). */
    breakdown: jsonb("breakdown").$type<Record<string, Record<string, number>>>().notNull().default({}),
    sprintTotal: numeric("sprint_total", { precision: 7, scale: 1 }),
    qualiTotal: numeric("quali_total", { precision: 7, scale: 1 }),
    raceTotal: numeric("race_total", { precision: 7, scale: 1 }),
    total: numeric("total", { precision: 7, scale: 1 }),
    isFinal: boolean("is_final").notNull().default(false),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("asset_points_one_asset", sql`(${t.stintId} is null) <> (${t.constructorId} is null)`),
    uniqueIndex("asset_points_stint_race").on(t.raceId, t.stintId),
    uniqueIndex("asset_points_constructor_race").on(t.raceId, t.constructorId),
  ],
);

/** Price of a person or constructor for one race. */
export const assetPrices = pgTable(
  "asset_prices",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    personId: integer("person_id").references(() => people.id),
    constructorId: integer("constructor_id").references(() => constructors.id),
    lastSeasonPrice: numeric("last_season_price", { precision: 7, scale: 2 }),
    last3: numeric("last3", { precision: 7, scale: 1 }),
    racesCounted: integer("races_counted"),
    formulaPrice: numeric("formula_price", { precision: 7, scale: 2 }),
    /** Commissioner override; when set it wins over the formula. */
    overridePrice: numeric("override_price", { precision: 7, scale: 2 }),
    finalPrice: numeric("final_price", { precision: 7, scale: 2 }).notNull(),
    frozenAt: timestamp("frozen_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    check("asset_prices_one_asset", sql`(${t.personId} is null) <> (${t.constructorId} is null)`),
    uniqueIndex("asset_prices_person_race").on(t.raceId, t.personId),
    uniqueIndex("asset_prices_constructor_race").on(t.raceId, t.constructorId),
  ],
);

/** New driver → the peer whose price becomes their last-season price (CAM ← OCO). */
export const pricePeers = pgTable("price_peers", {
  personId: integer("person_id")
    .primaryKey()
    .references(() => people.id),
  peerPersonId: integer("peer_person_id")
    .notNull()
    .references(() => people.id),
  seasonId: integer("season_id")
    .notNull()
    .references(() => seasons.id),
});

/** A league member. One account = one player; 2026 players exist before they sign in. */
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name").notNull(),
    userId: text("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    /** A signed-in user who says "this is me"; a commissioner confirms before userId is set. */
    claimRequestedBy: text("claim_requested_by").references(() => users.id, { onDelete: "set null" }),
    role: playerRole("role").notNull().default("player"),
    joinedAtRaceId: integer("joined_at_race_id").references(() => races.id),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("players_display_name").on(sql`lower(${t.displayName})`)],
);

/** A player's team for one race. */
export const picks = pgTable(
  "picks",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    doubleStintId: integer("double_stint_id").references(() => stints.id),
    driver1StintId: integer("driver1_stint_id").references(() => stints.id),
    driver2StintId: integer("driver2_stint_id").references(() => stints.id),
    driver3StintId: integer("driver3_stint_id").references(() => stints.id),
    driver4StintId: integer("driver4_stint_id").references(() => stints.id),
    constructorId: integer("constructor_id").references(() => constructors.id),
    frozenTeamPrice: numeric("frozen_team_price", { precision: 7, scale: 2 }),
    penalty: integer("penalty"),
    origin: pickOrigin("origin").notNull().default("manual"),
    savedAt: timestamp("saved_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("picks_player_race").on(t.playerId, t.raceId)],
);

export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    kind: inviteKind("kind").notNull(),
    token: text("token").notNull().unique(),
    email: text("email"),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    usedByUserId: text("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invites_email").on(t.email)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    type: text("type").notNull().default("24h"),
    sentAt: timestamp("sent_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("reminders_once").on(t.playerId, t.raceId, t.type)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    /** User id, or "job" for the scheduled job. */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    result: text("result").notNull().default("ok"),
    at: timestamp("at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("activity_log_at").on(t.at)],
);
