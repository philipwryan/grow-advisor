// The shapes both apps agree on.
//
// Deliberately app-agnostic: no Supabase client, no fetch, no env. GrowOS reads
// this grow with supabase-js and can reach Home Assistant on the LAN; Ryan Life
// reads the same tables over PostgREST from a deployed server and cannot. They
// share what the advisor *is*, not how either of them talks to a database.

export type AdvisorGrow = {
  id: string;
  name: string;
  medium: string;
  nutrients: string | null;
  /** ISO date the grow started. */
  startedAt: string;
  notes: string | null;
};

export type AdvisorPlant = {
  id: string;
  name: string;
  strain: string | null;
  seedType: string | null;
  /** ISO date this plant came up. Null until someone records it. */
  germinatedAt: string | null;
  /** Free text; doubles as the positional hint for the vision model. */
  notes: string | null;
};

export type PlanStatus = "ok" | "watch" | "act";

/** A row of growos_plant_plans, in the database's own casing. */
export type PlanRow = {
  id: string;
  plant_id: string;
  turn_id: string | null;
  status: PlanStatus;
  headline: string;
  next_action: string;
  detail: string | null;
  watch_for: string | null;
  created_at: string;
};

/** What `set_plant_plan` hands back to the host app to store. */
export type PlanInput = {
  plant: string;
  status: PlanStatus;
  headline: string;
  next_action: string;
  detail?: string;
  watch_for?: string;
  target_ec_min?: number;
  target_ec_max?: number;
  target_ph?: number;
  target_runoff_pct?: number;
};

/** What `propose_log_entry` hands back. Never written without a human click. */
export type LogEntryInput = {
  entry_type: string;
  notes: string;
  plant_name?: string;
  ec_in?: number;
  ec_runoff?: number;
  ph_in?: number;
  ph_runoff?: number;
  feed_volume_ml?: number;
  runoff_pct?: number;
  height_cm?: number;
  node_count?: number;
};

/**
 * Everything the tools need from the host app.
 *
 * Each app supplies its own implementation and its own honesty about what it
 * can reach. `tentNow` is the one that genuinely differs: GrowOS queries Home
 * Assistant live, Ryan Life returns the newest stored snapshot with its age —
 * which is why the return type is a string the tool passes through rather than
 * a fixed shape pretending both are the same reading.
 */
export type AdvisorHost = {
  /** Current conditions, however this app can get them. Say what it is. */
  tentNow(): Promise<string>;
  /** Aggregates over the hourly snapshot record for the last `days`. */
  envHistory(days: number): Promise<string>;
  /** Recent journal entries, newest first. */
  journal(limit: number): Promise<string>;
  /** Recent stored photo analyses, newest first. */
  photoAnalyses(limit: number): Promise<string>;
  /** The frame itself, as content blocks, or a string explaining why not. */
  photo(photoId?: string): Promise<unknown>;
  /** Store a plan. Returns the stored row so the UI can render it. */
  savePlan(plantId: string, input: PlanInput): Promise<PlanRow | null>;
  /** Stage a journal draft for a human to accept. */
  proposeLogEntry(input: LogEntryInput): Promise<void>;
};
