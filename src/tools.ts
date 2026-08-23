// The advisor's tools — the descriptions and schemas, once.
//
// Every `run()` here delegates to the host app, which supplies the data layer.
// That split is the whole point: the tool descriptions and the JSON schemas are
// what shape the model's behaviour and must not drift between the two apps;
// how a row is fetched is each app's own business.
//
// Only two of these write, and the difference matters:
//   - `set_plant_plan` writes without a human click, because a plan is advice
//     and the next one replaces it.
//   - `propose_log_entry` writes NOTHING. It stages a draft. A misparsed EC
//     value entering the journal silently would poison everything the advisor
//     later reasons over, so the journal takes a click.
// Neither can touch the roster or Home Assistant. This thing gives advice; it
// does not touch the tent.

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { AdvisorHost, AdvisorPlant, PlanStatus } from "./types.js";

export type ToolOptions = {
  /** Shown in `get_tent_now`'s description — see PromptOptions. */
  tentNowDescription: string;
};

export function advisorTools(
  plants: AdvisorPlant[],
  host: AdvisorHost,
  options: ToolOptions,
  /** Fired only after a plan row is actually stored. */
  onPlan: (plan: NonNullable<Awaited<ReturnType<AdvisorHost["savePlan"]>>>) => void = () => {},
) {
  const getTentNow = betaTool({
    name: "get_tent_now",
    description: `Current tent conditions: temperature, humidity, VPD and its target band, grow light and AC state. ${options.tentNowDescription}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => host.tentNow(),
  });

  const queryEnvHistory = betaTool({
    name: "query_env_history",
    description:
      "Summary statistics over the hourly tent environment snapshots. Returns min/max/average for temperature, humidity and VPD, split into lights-on and lights-off periods so day and night can be compared. Use for trends, swings, and 'how has it been' questions.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "How many days back to look. 1-60; use 7 for a normal check-in.",
        },
      },
      required: ["days"],
      additionalProperties: false,
    },
    run: ({ days }) => host.envHistory(Math.min(60, Math.max(1, days))),
  });

  const readJournal = betaTool({
    name: "read_journal",
    description:
      "Recent grow journal entries for this grow, newest first — feeds, readings, training, issues, notes. Check this before advising on anything that depends on what was last done.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many entries to return, 1-30." } },
      required: ["limit"],
      additionalProperties: false,
    },
    run: ({ limit }) => host.journal(Math.min(30, Math.max(1, limit))),
  });

  const readPhotoAnalyses = betaTool({
    name: "read_photo_analyses",
    description:
      "Recent vision analyses of tent photos, newest first: overall health score, stage assessment, observations, issues, per-plant verdicts, and a `measured` block wherever a scale marker was in frame. Each entry carries the photo_id and when the photo was taken — pass a photo_id to view_photo to look at the frame itself. Check the dates before treating any of this as current.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many analyses to return, 1-10." } },
      required: ["limit"],
      additionalProperties: false,
    },
    run: ({ limit }) => host.photoAnalyses(Math.min(10, Math.max(1, limit))),
  });

  /**
   * Hands the model the actual JPEG, not a description of it.
   *
   * Without this the advisor could only read text an earlier vision pass wrote,
   * so "what do you think of this leaf" had no picture behind it and a stale
   * summary was the best it could do.
   */
  const viewPhoto = betaTool({
    name: "view_photo",
    description:
      "Look at an actual photo from this grow. Omit photo_id for the most recent one, or pass an id from read_photo_analyses. Use this whenever the grower asks what a plant looks like, or wants you to check something visible — do not answer from an older written analysis when you can look at the frame yourself.",
    inputSchema: {
      type: "object",
      properties: {
        photo_id: {
          type: "string",
          description: "Which photo to look at. Omit for the newest photo in this grow.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ photo_id }) => host.photo(photo_id) as Promise<string>,
  });

  const setPlantPlan = betaTool({
    name: "set_plant_plan",
    description:
      "Record where one plant stands and the single next thing to do for it. This updates the card the grower sees pinned above the conversation. Call it once per plant you actually advised on, at the end of your answer, after any lookups. Skip it for small talk, for a question you could not answer, and for a plant you did not discuss — a card that repeats yesterday's advice is worse than no card.",
    inputSchema: {
      type: "object",
      properties: {
        plant: {
          type: "string",
          ...(plants.length > 0 ? { enum: plants.map((p) => p.name) } : {}),
          description: "Which plant on the roster this plan is for.",
        },
        status: {
          type: "string",
          enum: ["ok", "watch", "act"],
          description:
            "ok — on track, nothing wrong. watch — something to keep an eye on, no correction needed yet. act — something is wrong and needs correcting now. Routine feeding or watering is 'ok', not 'act'.",
        },
        headline: {
          type: "string",
          description:
            "One sentence on where this plant stands, in plain words. This replaces the status line on the card, so it should read on its own without the conversation around it.",
        },
        next_action: {
          type: "string",
          description:
            "The single next thing to do, as an instruction with the numbers in it — 'Feed to 10–20% runoff at EC 1.3, pH 5.8', not 'consider feeding'. One action, not a list.",
        },
        detail: {
          type: "string",
          description: "One short line of why or how, if it is not obvious from the action.",
        },
        watch_for: {
          type: "string",
          description:
            "What would change this call — a runoff reading, a colour, a measurement. Omit if nothing specific.",
        },
        target_ec_min: {
          type: "number",
          description:
            "If the action is a feed, the low end of the EC you are aiming for. The journal form offers these as hints beside empty boxes — they are targets, never recorded as readings. Omit when the action is not a feed.",
        },
        target_ec_max: { type: "number", description: "High end of the target EC." },
        target_ph: { type: "number", description: "Target pH going in." },
        target_runoff_pct: {
          type: "number",
          description: "Target runoff, as a percentage of feed.",
        },
      },
      required: ["plant", "status", "headline", "next_action"],
      additionalProperties: false,
    },
    run: async (input) => {
      const target = plants.find((p) => p.name === input.plant);
      if (!target) return `No plant named ${input.plant} on this grow's roster.`;
      try {
        const row = await host.savePlan(target.id, {
          ...input,
          status: input.status as PlanStatus,
        });
        if (row) onPlan(row);
        return `${input.plant}'s card now reads "${input.status}". The grower can see it above — no need to repeat it back to them in full.`;
      } catch (err) {
        return `Could not update that card: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    },
  });

  const proposeLogEntry = betaTool({
    name: "propose_log_entry",
    description:
      "Draft a grow journal entry for the grower to review. This does NOT write to the journal — it shows them a card they can save or discard. Use it whenever they mention something worth recording. Fill only the fields they actually told you; leave the rest out.",
    inputSchema: {
      type: "object",
      properties: {
        entry_type: {
          type: "string",
          enum: ["daily", "weekly", "feeding", "training", "issue", "milestone", "note"],
          description: "What kind of event this is.",
        },
        notes: { type: "string", description: "The entry text, in the grower's own terms." },
        plant_name: {
          type: "string",
          description:
            "Which plant, exactly as named on the roster, if the event was about one plant. Omit for whole-tent events.",
        },
        ec_in: { type: "number", description: "Feed EC going in, mS/cm." },
        ec_runoff: { type: "number", description: "Runoff EC, mS/cm." },
        ph_in: { type: "number", description: "Feed pH going in." },
        ph_runoff: { type: "number", description: "Runoff pH." },
        feed_volume_ml: { type: "number", description: "Volume fed, millilitres." },
        runoff_pct: { type: "number", description: "Runoff as a percentage of feed." },
        height_cm: { type: "number", description: "Plant height, centimetres." },
        node_count: { type: "integer", description: "Number of nodes." },
      },
      required: ["entry_type", "notes"],
      additionalProperties: false,
    },
    run: async (input) => {
      try {
        await host.proposeLogEntry(input);
        return "Draft entry shown to the grower for confirmation. Do not claim it has been saved — they still have to accept it. Mention briefly that it is waiting for them.";
      } catch (err) {
        return `Could not stage that entry: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    },
  });

  return [
    getTentNow,
    queryEnvHistory,
    readJournal,
    readPhotoAnalyses,
    viewPhoto,
    setPlantPlan,
    proposeLogEntry,
    // Server-side tool: runs on Anthropic's infrastructure, no run() of ours.
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 4 },
  ];
}

/** Friendly labels for the activity line while a turn is running. */
export const TOOL_LABELS: Record<string, string> = {
  get_tent_now: "reading the tent",
  query_env_history: "checking environment history",
  read_journal: "reading the journal",
  read_photo_analyses: "reviewing photo analyses",
  view_photo: "looking at a photo",
  set_plant_plan: "updating a plant card",
  propose_log_entry: "drafting a journal entry",
  propose_plant_update: "drafting a plant correction",
  web_search: "searching the web",
};
