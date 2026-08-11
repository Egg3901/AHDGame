// POST /api/country/[code]/sovereign-resolution/vote — Legislator vote on a sovereign-crisis bill.
// Auth: requireAuthWithCharacter; character must be seated in the active chamber.
// Body: { vote: "for" | "against" }
// Errors: 400 invalid body, 401, 403 not-in-active-chamber, 409 no-decision/window-closed/already-voted.

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
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
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
    return NextResponse.json(
      { error: "No active legislative ratification for this country" },
      { status: 409 }
    );
  }
  const decision = decisions[0];
  const idx = decision.currentChamberIndex ?? -1;
  const phases = decision.legislativePhases ?? [];
  const phase = phases[idx];
  if (!phase) {
    return NextResponse.json(
      { error: "No active chamber phase on this decision" },
      { status: 409 }
    );
  }

  if (phase.outcome !== "pending") {
    return NextResponse.json({ error: "Chamber has already tallied" }, { status: 409 });
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
    return NextResponse.json({ error: "Voting window has closed" }, { status: 409 });
  }

  const character = auth.user.character;
  const officeType = character.currentOffice?.type;
  const officeCfg = officeType ? getOfficeTypeConfig(upper, officeType) : undefined;
  const inActiveChamber =
    character.countryId === upper && officeCfg?.chamberKey === phase.chamberKey;
  if (!inActiveChamber) {
    return NextResponse.json(
      { error: "Only legislators in the active chamber may vote" },
      { status: 403 }
    );
  }

  const charKey = character._id.toString();
  if (phase.votes[charKey]) {
    return NextResponse.json({ error: "You have already voted on this chamber" }, { status: 409 });
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
    return NextResponse.json({ error: "You have already voted on this chamber" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, vote, chamberKey: phase.chamberKey });
}
