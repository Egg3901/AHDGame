// GET /api/imf/overview — IMF Corp + Board members + active sovereign bailouts + pending overrides.
// Auth: any authenticated user. Used by the /international/imf page.

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import type { Character } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";

export async function GET(_req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const imfCorp = await getImfCorporation(db);

  if (!imfCorp) {
    return NextResponse.json({
      imfCorp: null,
      boardMembers: [],
      totalReceivedAnchor: 0,
      activeSovereignBailouts: [],
      pendingBoardOverrides: [],
    });
  }

  const shareholderCharIds = imfCorp.shareholders
    .map((s) => s.characterId)
    .filter((id): id is ObjectId => !!id);

  const boardCharacters =
    shareholderCharIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: shareholderCharIds } })
          .project<{ _id: ObjectId; name: string; sequentialId?: number }>({
            name: 1,
            sequentialId: 1,
          })
          .toArray()
      : [];

  const activeBailouts = await db
    .collection<FederalBudget>("federalBudget")
    .find({ imfSovereignBailoutActive: true })
    .toArray();

  // Phase 11a: lifetime running tally summed across every country that has
  // paid into the facility (active OR previously-bailed). Anchor units.
  const paidInLifetime = await db
    .collection<FederalBudget>("federalBudget")
    .find({ imfSovereignFacilityCumulativePaidAnchor: { $gt: 0 } })
    .toArray();
  const totalReceivedAnchor = paidInLifetime.reduce(
    (a, b) => a + (b.imfSovereignFacilityCumulativePaidAnchor ?? 0),
    0
  );

  const nowMs = Date.now();
  const currentTurn = await getCurrentTurn(db);
  const pendingOverrides = await db
    .collection<FederalBudget>("federalBudget")
    .find({
      imfBoardOverrideWindowEndAt: { $exists: true, $ne: null },
      imfBoardOverrideAt: null,
    })
    .toArray();

  return NextResponse.json({
    currentTurn,
    imfCorp: {
      id: imfCorp._id.toString(),
      sequentialId: imfCorp.sequentialId ?? null,
      liquidCapital: imfCorp.liquidCapital ?? 0,
      liquidCurrencyCode: imfCorp.liquidCurrencyCode ?? "USD",
    },
    boardMembers: boardCharacters.map((c) => ({
      characterId: c._id.toString(),
      name: c.name,
      sequentialId: c.sequentialId ?? null,
    })),
    totalReceivedAnchor,
    activeSovereignBailouts: activeBailouts.map((b) => ({
      countryCode: b.countryId ?? String(b._id),
      principalOutstanding: b.imfSovereignFacilityPrincipalOutstanding ?? 0,
      annualRate: b.imfSovereignFacilityAnnualRate ?? 0,
      amortizationTurnsRemaining: b.imfSovereignFacilityAmortizationTurnsRemaining ?? 0,
      incomeCaptureFraction: b.imfSovereignFacilityIncomeCaptureFraction ?? 0,
      cumulativePaidAnchor: b.imfSovereignFacilityCumulativePaidAnchor ?? 0,
      crisisChoice: b.crisisChoice ?? null,
      recoveryStartedAt: b.recoveryStartedAt ?? null,
    })),
    pendingBoardOverrides: pendingOverrides
      // Turn-first "still open" filter (freezes on pause) with a wall-clock
      // fallback for windows opened before `.turn` existed.
      .filter((b) => {
        const w = b.imfBoardOverrideWindowEndAt;
        if (!w) return false;
        return typeof w.turn === "number" ? w.turn > currentTurn : (w.realtimeMs ?? 0) > nowMs;
      })
      .map((b) => ({
        countryCode: b.countryId ?? String(b._id),
        windowEndAtRealtimeMs: b.imfBoardOverrideWindowEndAt?.realtimeMs ?? 0,
        windowEndAtTurn: b.imfBoardOverrideWindowEndAt?.turn ?? null,
        crisisChoice: b.crisisChoice ?? null,
        facilityTerms: {
          principal: b.imfSovereignFacilityPrincipalOutstanding ?? 0,
          annualRate: b.imfSovereignFacilityAnnualRate ?? 0,
          incomeCaptureFraction: b.imfSovereignFacilityIncomeCaptureFraction ?? 0,
        },
      })),
  });
}
