// POST /api/country/[code]/sovereign-resolution — Submit a sovereign-crisis resolution choice.
// Auth: requireAuthWithCharacter; character must be the country's executive (or admin).
// Body: { choice: "bailout" | "repudiate" | "restructure" | "monetize" }
// Errors: 400 invalid country / unsupported choice, 401, 403 not-executive,
//         409 no-open-decision, 422 monetize-gated-by-inflation.
//
// Phase 9b: democracies route through legislative ratification — the route
// now sets the decision to "executiveProposed" and opens the lower chamber's
// 24h voting window. The orchestrator runs only after both chambers pass
// (per-turn legislative processor handles dispatch).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { COUNTRY_CONFIGS, getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { buildInitialLegislativePhases } from "@/lib/sovereignDefault/legislative/buildPhases";
import { MONETIZE_GATE_INFLATION } from "@/lib/sovereignDefault/constants";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";

const VALID_CHOICES = ["bailout", "repudiate", "restructure", "monetize"] as const;

const bodySchema = z.object({
  choice: z.enum(VALID_CHOICES),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return auth.response;

  const { code } = await params;
  const upper = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[upper]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const choice = parsed.data.choice;

  const character = auth.user.character;
  const officeType = character.currentOffice?.type;
  const officeCfg = officeType ? getOfficeTypeConfig(upper, officeType) : undefined;
  const userRecord = auth.user as { role?: string; isAdmin?: boolean };
  const isAdmin = userRecord.role === "admin" || userRecord.isAdmin === true;
  const isCountryExecutive =
    character.countryId === upper && !!officeCfg?.isExecutive && !officeCfg?.isSubNational;

  if (!isAdmin && !isCountryExecutive) {
    return NextResponse.json(
      { error: "Only the country's executive may submit a sovereign resolution" },
      { status: 403 }
    );
  }

  const db = await getDb();
  const decisions = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .find({ countryCode: upper, state: "open" })
    .sort({ firedAtTurn: -1 })
    .limit(1)
    .toArray();

  if (decisions.length === 0) {
    return NextResponse.json(
      { error: "No open sovereign crisis decision for this country" },
      { status: 409 }
    );
  }

  // Phase 9b: gate monetize on inflation BEFORE opening voting windows so
  // legislators don't waste 48h voting on a hard-gated proposal. Mirrors the
  // orchestrator's gate; the orchestrator itself runs after legislative pass.
  const budgetId = getNationalBudgetId(upper);
  if (choice === "monetize") {
    const budgetCheck = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId });
    const inflationFraction = (budgetCheck?.economicFactors?.inflationRate ?? 0) / 100;
    if (inflationFraction > MONETIZE_GATE_INFLATION) {
      return NextResponse.json(
        { error: "Monetize unavailable: inflation already above 8% — would cause hyperinflation" },
        { status: 422 }
      );
    }
  }

  // Open lower-chamber legislative ratification on the decision row, and
  // transition the budget into "crisisResolving" so Phase 4 detection skips
  // and the UI knows the country is awaiting ratification.
  const nowMs = Date.now();
  const currentTurn = await getCurrentTurn(db);
  const phases = buildInitialLegislativePhases(upper, nowMs, currentTurn);

  // Constrain on state="open" so a parallel double-click can't flip an
  // already-proposed decision back through the route. The second writer
  // matches no document (state has moved to "executiveProposed") and we
  // return 409 instead of silently overwriting `executiveChoice`.
  const result = await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
    { _id: decisions[0]._id, state: "open" },
    {
      $set: {
        state: "executiveProposed",
        executiveChoice: choice,
        executiveProposedAtRealtimeMs: nowMs,
        legislativePhases: phases,
        currentChamberIndex: 0,
        // Phase 11b: stamp the proposer so political impact lands on the
        // Character who chose this path, even if they leave office before
        // legislative ratification completes.
        proposingCharacterId: character._id,
      },
    }
  );
  if (result.modifiedCount === 0) {
    return NextResponse.json(
      { error: "Decision is no longer open (already proposed or expired)" },
      { status: 409 }
    );
  }

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: { sovereignCrisisState: "crisisResolving" } });

  return NextResponse.json({
    ok: true,
    status: "awaitingLegislativeRatification",
    chamberKey: phases[0].chamberKey,
  });
}
