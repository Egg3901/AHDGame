/**
 * POST /api/admin/country/[code]/regime/force-stage
 *
 * Admin-only: jump the regime escalation state directly to `toStage`.
 * Writes a synthetic transition history entry tagged `admin` so the
 * intervention is auditable. Resets dwell counters appropriately so
 * the per-turn driver doesn't immediately re-trip into the old stage.
 *
 * Body: { toStage: "stable" | "discontent" | "crisis" | "internalChallenge" | "collapse" }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import type {
  DecisionKind,
  RegimeStage,
  StageTransitionEvent,
} from "@/lib/db/types/regimeEscalation";
import { offerDecision } from "@/lib/onePartyState/decisionQueue";
import { fireFactionSplit } from "@/lib/onePartyState/factionSplit";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

const STAGE_VALUES: readonly RegimeStage[] = [
  "stable",
  "discontent",
  "crisis",
  "internalChallenge",
  "collapse",
] as const;

const bodySchema = z.object({
  toStage: z.enum(["stable", "discontent", "crisis", "internalChallenge", "collapse"]),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);
    const coll = getRegimeEscalationCollection(db);
    const state = await coll.findOne({ _id: countryId });
    const fromStage: RegimeStage = state?.currentStage ?? "stable";
    const toStage = parsed.data.toStage;

    const transition: StageTransitionEvent = {
      turn: currentTurn,
      from: fromStage,
      to: toStage,
      reason: "admin override",
      at: new Date(),
    };
    const newHistory = [transition, ...(state?.transitionHistory ?? [])].slice(0, 50);

    await coll.findOneAndUpdate(
      { _id: countryId },
      {
        $set: {
          currentStage: toStage,
          stageEnteredAtTurn: currentTurn,
          transitionHistory: newHistory,
          updatedAt: new Date(),
          // Reset dwell counters on the *target* stage so the per-turn
          // driver doesn't immediately re-trip from accumulated dwell.
          dwellCounters: {
            stage1: 0,
            stage2: { sustained: 0, cumulativeIn168: 0 },
            stage3: 0,
            stage4: 0,
          },
          // Clear any stale active decision + queue from a previous
          // organic transition or earlier force-stage. Admin force-
          // stage is "drop me in this state with a clean slate";
          // leaving a stale decision active would block the fresh
          // offer below from landing on the active slot.
          activeDecision: null,
          decisionQueue: [],
        },
      },
      { upsert: true }
    );

    // Mirror the per-turn driver's stage-transition follow-ups so admin
    // force-stage produces the same downstream effects (faction split
    // on Stage-3 entry + offered decision for the new stage). Without
    // this, force-stage to internalChallenge / collapse leaves the
    // active-decision card empty and there's nothing for the player to
    // act on — which is precisely the QA scenario the admin tool is
    // meant to set up. Offer fires whenever the target stage is non-
    // stable (no fromStage gate) so re-issuing the same stage refreshes
    // the offer for testing.
    let factionSplitResult: Awaited<ReturnType<typeof fireFactionSplit>> = null;
    if (toStage === "internalChallenge") {
      factionSplitResult = await fireFactionSplit(db, countryId, currentTurn);
    }
    if (toStage !== "stable") {
      const hogId = await getHeadOfGovernmentCharacterId(db, countryId);
      if (hogId) {
        const kind = decisionKindForStage(toStage);
        await offerDecision(db, countryId, {
          kind,
          leaderCharacterId: hogId,
          offeredAtTurn: currentTurn,
          payload: factionSplitResult
            ? {
                defectedPartySequentialId: factionSplitResult.newPartySequentialId,
                defectorCount: factionSplitResult.defectorCount,
              }
            : {},
        });
      }
    }

    return NextResponse.json({
      ok: true,
      fromStage,
      toStage,
      atTurn: currentTurn,
      validStages: STAGE_VALUES,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

function decisionKindForStage(stage: Exclude<RegimeStage, "stable">): DecisionKind {
  switch (stage) {
    case "discontent":
      return "stage1.addressDiscontent";
    case "crisis":
      return "stage2.respondToUnrest";
    case "internalChallenge":
      return "stage3.respondToFactionSplit";
    case "collapse":
      return "stage4.faceCollapse";
  }
}
