import type { Db } from "mongodb";
import type { LivingConflictState } from "@/lib/livingConflict/types";
import type { CampaignConsequences } from "@/lib/db/types/livingConflictCampaign";
import { buildDecisionHistory } from "@/lib/crises/decisionHistory";
import type { CrisisDecisionNode } from "@/lib/db/types/crisis";

/** The seven families in the 1991 to 2027 program (#2158). */
export const HORIZON_CRISIS_KEYS = [
  "northern_ireland",
  "yugoslav_dissolution",
  "transnational_terrorism",
  "global_financial_crisis",
  "arab_uprisings",
  "russia_ukraine_security",
  "pandemic",
] as const;

export const CRISIS_HORIZON_SCHEMA = 1;
export const CRISIS_HORIZON_CALC = 1;
export const CRISIS_HORIZON_RETENTION = "world-raw-full";

export interface CrisisHorizonPoint {
  _id: string;
  runId: string;
  turn: number;
  year: number;
  defKey: string;
  sourceClass: "sandbox";
  codeVersion: string;
  seed: string;
  schemaVersion: number;
  calculationVersion: number;
  retentionPolicy: string;
  /** The complete run manifest is stored once in simRuns, never copied per point. */
  manifestRunId: string;
  presence: "absent" | "present";
  hasOpened: boolean | null;
  status: string | null;
  phaseLevel: number | null;
  intensity: number | null;
  pressure: Record<string, number> | null;
  tracks: Record<string, number> | null;
  campaignStage: string | null;
  campaignCycle: number | null;
  consequences: CampaignConsequences | null;
  /** Cumulative authored event and response counts as of this completed turn. */
  events: number;
  responses: number;
  automaticResolutions: number;
  resolutions: number;
}

interface EventRow {
  _id: unknown;
  livingConflictEventId?: string;
}

interface InteractionRow {
  crisisId: unknown;
  leaderResponses?: unknown[];
  resolutionPath?: string[];
  decisionTree?: CrisisDecisionNode[];
  resolutionOutcome?: string | null;
  resolvedAt?: Date | null;
}

export async function captureCrisisHorizonTurn(
  db: Db,
  input: { runId: string; turn: number; seed: string; codeVersion: string }
): Promise<void> {
  if (!db.databaseName.startsWith("ahd_sim_")) {
    throw new Error("Crisis horizon telemetry is sandbox-only");
  }
  if (!input.codeVersion || !input.runId || !Number.isInteger(input.turn)) {
    throw new Error("Crisis horizon telemetry needs a pinned source, run and turn");
  }
  const game = await db
    .collection<{ _id: string; currentTurn: number; currentYear: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, currentYear: 1 } });
  if (game?.currentTurn !== input.turn || !Number.isFinite(game.currentYear)) {
    throw new Error(`Crisis horizon turn mismatch at ${input.turn}`);
  }
  const [states, events] = await Promise.all([
    db
      .collection<LivingConflictState>("livingConflicts")
      .find({ defKey: { $in: [...HORIZON_CRISIS_KEYS] } })
      .toArray(),
    db
      .collection<EventRow>("crises")
      .find(
        { livingConflictEventId: { $exists: true } },
        { projection: { _id: 1, livingConflictEventId: 1 } }
      )
      .toArray(),
  ]);
  const byKey = new Map<string, LivingConflictState>();
  for (const state of states) {
    if (byKey.has(state.defKey)) throw new Error(`Duplicate living conflict ${state.defKey}`);
    byKey.set(state.defKey, state);
  }
  const interactions = events.length
    ? await db
        .collection<InteractionRow>("crisisInteractions")
        .find(
          { crisisId: { $in: events.map((event) => event._id) } },
          {
            projection: {
              crisisId: 1,
              leaderResponses: 1,
              resolutionPath: 1,
              decisionTree: 1,
              resolutionOutcome: 1,
              resolvedAt: 1,
            },
          }
        )
        .toArray()
    : [];
  const eventKey = new Map(
    events.map((event) => [String(event._id), event.livingConflictEventId?.split(":")[0] ?? ""])
  );
  const counters = new Map<
    string,
    { events: number; responses: number; automaticResolutions: number; resolutions: number }
  >();
  for (const key of HORIZON_CRISIS_KEYS)
    counters.set(key, { events: 0, responses: 0, automaticResolutions: 0, resolutions: 0 });
  for (const event of events) {
    const counter = counters.get(eventKey.get(String(event._id)) ?? "");
    if (counter) counter.events++;
  }
  for (const interaction of interactions) {
    const counter = counters.get(eventKey.get(String(interaction.crisisId)) ?? "");
    if (!counter) continue;
    counter.responses +=
      interaction.leaderResponses?.length ||
      buildDecisionHistory(interaction.decisionTree ?? [], interaction.resolutionPath ?? []).length;
    if (interaction.resolvedAt) counter.resolutions++;
    if (interaction.resolutionOutcome === "auto") counter.automaticResolutions++;
  }
  const collection = db.collection<CrisisHorizonPoint>("simCrisisHorizon");
  await collection.bulkWrite(
    HORIZON_CRISIS_KEYS.map((defKey) => {
      const state = byKey.get(defKey);
      const point: CrisisHorizonPoint = {
        _id: `${input.runId}:${input.turn}:${defKey}`,
        runId: input.runId,
        turn: input.turn,
        year: game.currentYear,
        defKey,
        sourceClass: "sandbox",
        codeVersion: input.codeVersion,
        seed: input.seed,
        schemaVersion: CRISIS_HORIZON_SCHEMA,
        calculationVersion: CRISIS_HORIZON_CALC,
        retentionPolicy: CRISIS_HORIZON_RETENTION,
        manifestRunId: input.runId,
        presence: state ? "present" : "absent",
        hasOpened: state?.hasOpened ?? null,
        status: state?.status ?? null,
        phaseLevel: state?.phaseLevel ?? null,
        intensity: state?.intensity ?? null,
        pressure: state?.pressure ?? null,
        tracks: state?.tracks ?? null,
        campaignStage: state?.campaign?.stage ?? null,
        campaignCycle: state?.campaign?.cycle ?? null,
        consequences: state?.campaign?.consequences ?? null,
        ...counters.get(defKey)!,
      };
      return {
        updateOne: { filter: { _id: point._id }, update: { $setOnInsert: point }, upsert: true },
      };
    }),
    { ordered: false }
  );
}
