// POST /api/imf/board/override — IMF Board action during the 12h post-grant window.
// Auth: requireAuthWithCharacter; character must be an IMF Corp shareholder (Board member).
// Body: { countryCode, action: "modify-terms"|"endorse"|"criticize"|"no-action",
//         rateDelta?, captureDelta?, statement? }
// Errors: 400 invalid body, 401, 403 not-board, 404 no-budget, 409 window expired or already actioned.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { isImfBoardMember } from "@/lib/imf/isImfBoardMember";
import { applyCrossCountryTrustHit } from "@/lib/sovereignDefault/sideEffects/trustHit";
import { emitImfBoardStatementNews } from "@/lib/sovereignDefault/crisisNews";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  IMF_BOARD_RATE_DELTA_BOUND,
  IMF_BOARD_CAPTURE_DELTA_BOUND,
  IMF_BOARD_PUBLIC_TRUST_DELTA,
} from "@/lib/sovereignDefault/constants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget, ImfBoardOverrideKind } from "@/lib/db/types/budget";

const VALID_ACTIONS = ["modify-terms", "endorse", "criticize", "no-action"] as const;

const bodySchema = z.object({
  countryCode: z.string().min(1, "countryCode required"),
  action: z.enum(VALID_ACTIONS),
  rateDelta: z.number().optional(),
  captureDelta: z.number().optional(),
  statement: z.string().max(2000).optional(),
});

function clamp(value: number, bound: number): number {
  return Math.max(-bound, Math.min(bound, value));
}

export async function POST(req: Request) {
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const body = parsed.data;

  const upper = body.countryCode.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[upper]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }
  const action = body.action;

  const db = await getDb();
  const imfCorp = await getImfCorporation(db);
  if (!imfCorp) {
    return NextResponse.json({ error: "IMF Corp not seeded" }, { status: 503 });
  }

  if (
    !isImfBoardMember({
      imfCorpShareholders: imfCorp.shareholders,
      characterId: auth.user.character._id,
    })
  ) {
    return NextResponse.json({ error: "Only IMF Board members may act" }, { status: 403 });
  }

  const budgetId = getNationalBudgetId(upper);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) {
    return NextResponse.json({ error: "Country budget not found" }, { status: 404 });
  }

  if (budget.imfBoardOverrideAt) {
    return NextResponse.json(
      { error: "Override already actioned for this window" },
      { status: 409 }
    );
  }
  const nowMs = Date.now();
  const currentTurn = await getCurrentTurn(db);
  // Turn-first window check (freezes on pause) with a wall-clock fallback for
  // windows opened before `imfBoardOverrideWindowEndAt.turn` existed. A missing
  // window is treated as expired.
  const windowEnd = budget.imfBoardOverrideWindowEndAt;
  const windowExpired = !windowEnd
    ? true
    : typeof windowEnd.turn === "number"
      ? currentTurn >= windowEnd.turn
      : windowEnd.realtimeMs <= nowMs;
  if (windowExpired) {
    return NextResponse.json({ error: "Override window has expired" }, { status: 409 });
  }

  const set: Partial<FederalBudget> = {
    imfBoardOverrideAt: { turn: currentTurn, realtimeMs: nowMs },
    imfBoardOverrideBy: auth.user.character._id,
  };
  let kind: ImfBoardOverrideKind | null = null;

  let trustDelta = 0;
  if (action === "modify-terms") {
    // rateDelta is in percentage points; the constant 0.02 represents a fractional
    // rate of ±2pp on an annual percentage rate. So clamp the pp delta at 2.
    const rateDeltaPp = clamp(body.rateDelta ?? 0, IMF_BOARD_RATE_DELTA_BOUND * 100);
    const captureDelta = clamp(body.captureDelta ?? 0, IMF_BOARD_CAPTURE_DELTA_BOUND);
    set.imfSovereignFacilityAnnualRate = (budget.imfSovereignFacilityAnnualRate ?? 0) + rateDeltaPp;
    set.imfSovereignFacilityIncomeCaptureFraction =
      (budget.imfSovereignFacilityIncomeCaptureFraction ?? 0) + captureDelta;
    set.imfBoardOverrideRateDelta = rateDeltaPp;
    set.imfBoardOverrideCaptureDelta = captureDelta;
    kind = "termsModified";
  } else if (action === "endorse" || action === "criticize") {
    set.imfBoardPublicStatement = body.statement ?? "";
    kind = action === "endorse" ? "publicEndorsement" : "publicCriticism";
    trustDelta =
      action === "endorse" ? IMF_BOARD_PUBLIC_TRUST_DELTA : -IMF_BOARD_PUBLIC_TRUST_DELTA;
  }
  set.imfBoardOverrideKind = kind;

  // Guard against the read-check-write race: two parallel board members could
  // both pass the `imfBoardOverrideAt` null-check above. Without an atomic
  // filter both writes succeed and the rate/capture deltas don't compose
  // correctly (each writer's $set computes from the original budget value, so
  // the first writer's change is silently lost). Constrain the filter on
  // imfBoardOverrideAt being null — if a second writer arrives, modifiedCount
  // is 0 and we return 409. The trust-hit side-effect runs only AFTER the
  // atomic guard succeeds so a losing race doesn't double-apply public-trust.
  const result = await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId, imfBoardOverrideAt: null }, { $set: set });
  if (result.modifiedCount === 0) {
    return NextResponse.json(
      { error: "Override already actioned for this window" },
      { status: 409 }
    );
  }

  if (trustDelta !== 0) {
    await applyCrossCountryTrustHit(db, upper, trustDelta);
    if (kind === "publicEndorsement" || kind === "publicCriticism") {
      // News emit is best-effort — failing to post the public statement
      // shouldn't fail the override (the trust hit and DB write already
      // succeeded). Swallow + log so the caller still sees ok.
      try {
        await emitImfBoardStatementNews(upper, kind, body.statement ?? "");
      } catch (err) {
        console.error("emitImfBoardStatementNews failed", err);
      }
    }
  }

  return NextResponse.json({ ok: true, applied: { action, kind } });
}
