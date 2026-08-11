// GET /api/character/[id]/sovereign-holdings — Per-country sovereign bond aggregate
// for a character + their demand-share contribution per country.
// Auth: requireAuth
// Errors: 400 (invalid id), 401

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { computeRequiredIssuance } from "@/lib/sovereignDefault/requiredIssuance";
import { ENTITY_DEMAND_WEIGHT } from "@/lib/sovereignDefault/constants";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }
  const characterId = new ObjectId(id);
  const characterIdStr = characterId.toString();

  const db = await getDb();
  const currentTurn = await getCurrentTurn(db);

  // All active sovereign bonds the character holds (any country)
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      matured: false,
      defaulted: false,
      "holders.characterId": characterId,
    })
    .toArray();

  // Aggregate units by country
  const unitsByCountry = new Map<string, number>();
  for (const bond of bonds) {
    if (!bond.countryId) continue;
    let myUnits = 0;
    for (const holder of bond.holders ?? []) {
      if (holder.characterId?.toString() === characterIdStr) {
        myUnits += holder.units ?? 0;
      }
    }
    if (myUnits > 0) {
      unitsByCountry.set(bond.countryId, (unitsByCountry.get(bond.countryId) ?? 0) + myUnits);
    }
  }

  // Per country: face value + this character's marginal demand contribution.
  const holdings = await Promise.all(
    Array.from(unitsByCountry.entries()).map(async ([countryCode, units]) => {
      const faceValue = units * BOND_UNIT_FACE_VALUE;
      const requiredIssuance = await computeRequiredIssuance(db, countryCode, currentTurn);
      const demandContribution =
        requiredIssuance > 0 ? (faceValue / requiredIssuance) * ENTITY_DEMAND_WEIGHT : 0;
      return { countryCode, faceValue, demandContribution };
    })
  );
  holdings.sort((a, b) => b.faceValue - a.faceValue);

  return NextResponse.json({ characterId: id, currentTurn, holdings });
}
