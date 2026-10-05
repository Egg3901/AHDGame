// POST /api/country/[code]/sovereign-resolution/vote — Legislator vote on a sovereign-crisis bill.
// Auth: requireAuthWithCharacter; character must be seated in the active chamber.
// Body: { vote: "for" | "against" }
// Errors: 400 invalid body, 401, 403 not-in-active-chamber, 409 no-decision/window-closed/already-voted.

import { errorResponse } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { COUNTRY_CONFIGS, getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";

const bodySchema = z.object({
  vote: z.enum(["for", "against"]),
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
    return errorResponse(400, "Invalid country code");
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.success) {
    return errorResponse(parsed.status, parsed.error);
  }
  const vote = parsed.data.vote;

  const db = await getDb();
  const decisions = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .find({ countryCode: upper, state: "executiveProposed" })
    .sort({ firedAtTurn: -1 })
    .limit(1)
    .toArray();
  if (decisions.length === 0) {
    return errorResponse(409, "No active legislative ratification for this country");
  }
  const decision = decisions[0];
  const idx = decision.currentChamberIndex ?? -1;
  const phases = decision.legislativePhases ?? [];
  const phase = phases[idx];
  if (!phase) {
    return errorResponse(409, "No active chamber phase on this decision");
  }

  if (phase.outcome !== "pending") {
    return errorResponse(409, "Chamber has already tallied");
  }
  // Turn-first window check (matches the per-turn processor) with a wall-clock
  // fallback for phases opened before `endsOnTurn` existed.
  const nowMs = Date.now();
  const currentTurn = await getCurrentTurn(db);
  const windowClosed =
    typeof phase.endsOnTurn === "number"
      ? currentTurn >= phase.endsOnTurn
      : phase.endsAtRealtimeMs <= nowMs;
  if (windowClosed) {
    return errorResponse(409, "Voting window has closed");
  }

  const character = auth.user.character;
  const officeType = character.currentOffice?.type;
  const officeCfg = officeType ? getOfficeTypeConfig(upper, officeType) : undefined;
  const inActiveChamber =
    character.countryId === upper && officeCfg?.chamberKey === phase.chamberKey;
  if (!inActiveChamber) {
    return errorResponse(403, "Only legislators in the active chamber may vote");
  }

  const charKey = character._id.toString();
  if (phase.votes[charKey]) {
    return errorResponse(409, "You have already voted on this chamber");
  }

  const counterField = vote === "for" ? "votesFor" : "votesAgainst";
  const voteFieldKey = `legislativePhases.${idx}.votes.${charKey}`;
  // Guard against the read-check-write race: two parallel requests from the
  // same legislator could both pass the in-memory `phase.votes[charKey]` check,
  // and without an atomic filter both would $inc the counter, corrupting the
  // tally. Filter on the dotted-path field NOT existing so the second writer
  // matches no document and modifiedCount stays at 0.
  const result = await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
    { _id: decision._id, [voteFieldKey]: { $exists: false } },
    {
      $set: { [voteFieldKey]: vote },
      $inc: { [`legislativePhases.${idx}.${counterField}`]: 1 },
    }
  );
  if (result.modifiedCount === 0) {
    return errorResponse(409, "You have already voted on this chamber");
  }

  return NextResponse.json({ ok: true, vote, chamberKey: phase.chamberKey });
}
