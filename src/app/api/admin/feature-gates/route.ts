import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState, NppAutonomyLevel } from "@/lib/db/types";

/**
 * Unified admin control surface for the game's feature gates. Reads/writes the
 * boolean flags + the 4-state NPP-autonomy level that all live on the
 * `gameState` doc, so the admin dashboard can drive every gate from one panel.
 *
 * NPP economy, line of credit, and index funds are intentionally NOT here — they
 * are core systems that ship on by default (see seeds/reference/gameConfig.ts).
 */

/** Boolean feature flags exposed by this endpoint, in display order. */
export const FEATURE_GATE_BOOLEAN_KEYS = [
  "forexEnabled",
  "playerRandomEventsEnabled",
  "crisisInteractionEnabled",
  "autoDisastersEnabled",
  "crisisAidBillsEnabled",
  "demographicsLayer1PositionsEnabled",
  "granularElectorateEnabled",
  "rpgStatsEnabled",
  "autoSectorSeedEnabled",
  "extractionAutoStrategyEnabled",
  "redistrictingEnabled",
  "sectorTechTreesEnabled",
  "eraSystemEnabled",
  "liveElectionResultsEnabled",
  "legislationDemographicEffectsV2Enabled",
  "onboardingChecklistEnabled",
  "macroGrowthV1",
  "embargoTradeExposureEnabled",
  "granularPollEnabled",
  "seasonRecapEnabled",
  "intOrgAlignmentEnabled",
  "nppCorpStrategyEnabled",
] as const;

type FeatureGateBooleanKey = (typeof FEATURE_GATE_BOOLEAN_KEYS)[number];

/**
 * Gates whose ABSENCE means enabled.
 *
 * Every other flag here reads `doc[key] === true`, so a field that was never
 * written reads false. That is right for a staged rollout and wrong for a
 * behaviour that already shipped on: adding such a flag to this endpoint would
 * have reported it as OFF on every existing world while the engine ran it, and
 * the first admin write would have been the first time the two agreed.
 *
 * For these keys, absent and `true` both read enabled; only an explicit `false`
 * disables.
 */
export const FEATURE_GATE_DEFAULT_ON: ReadonlySet<string> = new Set(["nppCorpStrategyEnabled"]);

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("boolean"),
    key: z.enum(FEATURE_GATE_BOOLEAN_KEYS),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("level"),
    value: z.enum(["off", "v0", "v1", "v2", "v3", "v4"]),
  }),
]);

interface FeatureGatesState {
  booleans: Record<FeatureGateBooleanKey, boolean>;
  nppAutonomyLevel: NppAutonomyLevel;
}

async function readState(): Promise<FeatureGatesState> {
  const db = await getDb();
  const doc = await db.collection<GameState>("gameState").findOne({ _id: "current" });

  const booleans = Object.fromEntries(
    FEATURE_GATE_BOOLEAN_KEYS.map((k) => {
      const raw = (doc as Record<string, unknown> | null)?.[k];
      return [k, FEATURE_GATE_DEFAULT_ON.has(k) ? raw !== false : raw === true];
    })
  ) as Record<FeatureGateBooleanKey, boolean>;

  // Level read mirrors getNppAutonomyLevel: explicit level wins, else legacy boolean.
  const nppAutonomyLevel: NppAutonomyLevel =
    doc?.nppAutonomyLevel ?? (doc?.nppAutonomyEnabled === true ? "v0" : "off");

  return { booleans, nppAutonomyLevel };
}

/** GET /api/admin/feature-gates — current state of every gate. */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    return NextResponse.json(await readState());
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/admin/feature-gates — set one gate (boolean flag or the NPP level). */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const nowIso = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ""> = {};

    if (parsed.data.kind === "boolean") {
      const { key, value } = parsed.data;
      set[key] = value;
      // Each flag carries an `${key}By`/`${key}At` audit stamp; clear it on disable.
      if (value) {
        set[`${key}By`] = auth.admin.username;
        set[`${key}At`] = nowIso;
      } else {
        unset[`${key}By`] = "";
        unset[`${key}At`] = "";
      }
    } else {
      const level = parsed.data.value as NppAutonomyLevel;
      set.nppAutonomyLevel = level;
      // Keep the legacy boolean in sync for back-compat readers.
      set.nppAutonomyEnabled = level !== "off";
      if (level !== "off") {
        set.nppAutonomyEnabledBy = auth.admin.username;
        set.nppAutonomyEnabledAt = nowIso;
      } else {
        unset.nppAutonomyEnabledBy = "";
        unset.nppAutonomyEnabledAt = "";
      }
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    await db.collection<GameState>("gameState").updateOne({ _id: "current" }, update);

    return NextResponse.json({ success: true, ...(await readState()) });
  } catch (error) {
    return handleRouteError(error);
  }
}
