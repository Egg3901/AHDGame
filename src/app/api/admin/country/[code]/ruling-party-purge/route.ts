/**
 * Admin API: Ruling-Party Purge Events
 *
 * POST /api/admin/country/[code]/ruling-party-purge
 * Body: { severity: PurgeSeverity, reason: string, targetCount?: number }
 *
 * NOT a data wipe. This route does NOT delete any documents — it inserts
 * a single simulation event into the `rulingPartyPurgeEvents` collection,
 * which `onePartyBillLifecycle` consumes on the next turn to apply a
 * confidence delta to the country's seated ruling-party leader.
 *
 * Country must have `governmentType: "onePartyState"`. Admin-only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PurgeEvent, PurgeSeverity } from "@/lib/turn/rulingPartyPriorities";
import { PURGE_SEVERITY_DELTA } from "@/lib/turn/rulingPartyPriorities";

const PURGE_BODY_SCHEMA = z.object({
  severity: z.enum(["minor", "regional", "senior", "faction", "extreme"]),
  reason: z.string().min(3),
  targetCount: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
  }
  if (config.governmentType !== "onePartyState") {
    return NextResponse.json({ error: "Country is not a one-party state" }, { status: 400 });
  }

  const adminCheck = await requireAdmin();
  if (!adminCheck.ok) return adminCheck.response;

  const parsed = await parseJsonBody(request, PURGE_BODY_SCHEMA);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { severity, reason, targetCount } = parsed.data;

  const db = await getDb();
  const gameState = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? 0;

  const purgeDoc: PurgeEvent = {
    _id: new ObjectId().toString(),
    countryId,
    severity: severity as PurgeSeverity,
    reason,
    targetCount,
    turn: currentTurn,
    processed: false,
    createdAt: new Date(),
  };

  await db.collection<PurgeEvent>("rulingPartyPurgeEvents").insertOne(purgeDoc);

  return NextResponse.json({
    success: true,
    purge: {
      id: purgeDoc._id,
      severity: purgeDoc.severity,
      reason: purgeDoc.reason,
      confidenceDelta: PURGE_SEVERITY_DELTA[purgeDoc.severity],
      turn: purgeDoc.turn,
    },
  });
}
