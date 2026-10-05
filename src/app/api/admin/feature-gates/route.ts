import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type {
  GameState,
  NppEntryViabilityMode,
  NppAutonomyLevel,
  NppForeignPolicyMode,
  NppForeignPolicyStage,
} from "@/lib/db/types";
import {
  foreignPolicyModeFrom,
  foreignPolicyStageFrom,
} from "@/lib/nppAutonomy/foreignPolicyRollout";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  RESET_SYSTEMS,
  resetSeedComplete,
  resetSystemSelectionsFrom,
  resetSystemVersionsFrom,
  resetVersionSelectionEligibility,
  type ResetSystem,
  type ResetSystemVersion,
} from "@/lib/resetVersions/rules";

/**
 * Unified admin control surface for the game's feature gates. Reads/writes the
 * boolean flags, the six-state NPP autonomy level, and the three-state foreign
 * policy rollout that all live on the `gameState` doc.
 *
 * NPP economy, line of credit, and index funds are intentionally NOT here — they
 * are core systems that ship on by default (see seeds/reference/gameConfig.ts).
 */

/** Boolean feature flags exposed by this endpoint, in display order. */
export const FEATURE_GATE_BOOLEAN_KEYS = [
  "forexEnabled",
  "playerRandomEventsEnabled",
  "crisisInteractionEnabled",
  "livingConflictsEnabled",
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
  "settlementCrisisEnabled",
  "departmentFinanceEnabled",
  "lawAdministrationEnabled",
  "regionalLegislationFinanceEnabled",
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

export const FEATURE_GATE_VERSION_SYSTEMS = RESET_SYSTEMS;

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("boolean"),
    key: z.enum(FEATURE_GATE_BOOLEAN_KEYS),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("level"),
    value: z.enum(["off", "v0", "v1", "v2", "v3", "v4", "v5"]),
  }),
  z.object({
    kind: z.literal("foreign-policy-mode"),
    value: z.enum(["off", "shadow", "active"]),
  }),
  z.object({
    kind: z.literal("foreign-policy-stage"),
    value: z.enum(["votes", "proposals", "trade", "support", "war"]),
  }),
  z.object({
    kind: z.literal("npp-entry-viability-mode"),
    value: z.enum(["off", "observe", "enforce"]),
  }),
  z.object({
    kind: z.literal("reset-system-version"),
    system: z.enum(RESET_SYSTEMS),
    value: z.enum(["v1", "v2"]),
  }),
]);

interface FeatureGatesState {
  booleans: Record<FeatureGateBooleanKey, boolean>;
  nppAutonomyLevel: NppAutonomyLevel;
  nppForeignPolicyMode: NppForeignPolicyMode;
  nppForeignPolicyStage: NppForeignPolicyStage;
  nppEntryViabilityMode: NppEntryViabilityMode;
  resetSystemVersions: Record<ResetSystem, ResetSystemVersion>;
  resetSystemSelections: Record<ResetSystem, ResetSystemVersion>;
  resetV2Ready: Readonly<Record<ResetSystem, boolean>>;
  resetV2Seeded: Record<ResetSystem, boolean>;
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

  const nppForeignPolicyMode: NppForeignPolicyMode = foreignPolicyModeFrom(
    doc?.nppForeignPolicyMode
  );
  const nppForeignPolicyStage = foreignPolicyStageFrom(doc?.nppForeignPolicyStage);
  const nppEntryViabilityMode: NppEntryViabilityMode =
    doc?.nppEntryViabilityMode === "off" || doc?.nppEntryViabilityMode === "enforce"
      ? doc.nppEntryViabilityMode
      : "observe";

  return {
    booleans,
    nppAutonomyLevel,
    nppForeignPolicyMode,
    nppForeignPolicyStage,
    nppEntryViabilityMode,
    resetSystemVersions: resetSystemVersionsFrom(doc, RESET_V2_READY),
    resetSystemSelections: resetSystemSelectionsFrom(doc),
    resetV2Ready: RESET_V2_READY,
    resetV2Seeded: Object.fromEntries(
      RESET_SYSTEMS.map((system) => [system, resetSeedComplete(doc, system)])
    ) as Record<ResetSystem, boolean>,
  };
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

/** POST /api/admin/feature-gates sets one boolean, autonomy level, or policy mode. */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    if (
      parsed.data.kind === "reset-system-version" &&
      parsed.data.value === "v2" &&
      !RESET_V2_READY[parsed.data.system]
    ) {
      return errorResponse(
        409,
        `${parsed.data.system} v2 is not available until its complete runtime path ships.`
      );
    }

    const db = await getDb();
    const resetChange = parsed.data.kind === "reset-system-version" ? parsed.data : null;
    let resetFilter: Record<string, unknown> = { _id: "current" };
    if (resetChange) {
      const gameState = await db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            metricsSystemVersion: 1,
            legislationSystemVersion: 1,
            cabinetSystemVersion: 1,
            resetSystemSelections: 1,
            resetWorldId: 1,
          },
        }
      );
      if (!gameState) {
        return errorResponse(409, "No game world is initialized.");
      }
      const eligibility = resetVersionSelectionEligibility(
        gameState,
        resetChange.system,
        resetChange.value,
        RESET_V2_READY
      );
      if (!eligibility.allowed) {
        const error =
          eligibility.reason === "metrics_required"
            ? "Select Metrics v2 for the next reset before Legislation or Cabinet v2."
            : eligibility.reason === "dependent_v2"
              ? "Return Legislation and Cabinet to v1 before selecting Metrics v1."
              : `${resetChange.system} v2 is not available until its complete runtime path ships.`;
        return errorResponse(409, error);
      }
      resetFilter = {
        _id: "current",
        resetWorldId: gameState.resetWorldId ?? { $exists: false },
        ...Object.fromEntries(
          RESET_SYSTEMS.map((system) => [
            `resetSystemSelections.${system}`,
            gameState.resetSystemSelections?.[system] ?? { $exists: false },
          ])
        ),
      };
    }
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
    } else if (parsed.data.kind === "level") {
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
    } else if (parsed.data.kind === "foreign-policy-mode") {
      const mode = parsed.data.value as NppForeignPolicyMode;
      set.nppForeignPolicyMode = mode;
      set.nppForeignPolicyModeBy = auth.admin.username;
      set.nppForeignPolicyModeAt = nowIso;
    } else if (parsed.data.kind === "foreign-policy-stage") {
      const stage = parsed.data.value as NppForeignPolicyStage;
      set.nppForeignPolicyStage = stage;
      set.nppForeignPolicyStageBy = auth.admin.username;
      set.nppForeignPolicyStageAt = nowIso;
    } else if (parsed.data.kind === "npp-entry-viability-mode") {
      const mode = parsed.data.value as NppEntryViabilityMode;
      set.nppEntryViabilityMode = mode;
      set.nppEntryViabilityModeBy = auth.admin.username;
      set.nppEntryViabilityModeAt = nowIso;
    } else {
      set[`resetSystemSelections.${parsed.data.system}`] = parsed.data.value;
      set[`resetSystemSelectionsAudit.${parsed.data.system}`] = {
        by: auth.admin.username,
        at: nowIso,
      };
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const result = await db.collection<GameState>("gameState").updateOne(resetFilter, update);
    if (resetChange && result.matchedCount === 0) {
      return errorResponse(
        409,
        "The system versions changed during this request. Reload and try again."
      );
    }

    return NextResponse.json({ success: true, ...(await readState()) });
  } catch (error) {
    return handleRouteError(error);
  }
}
