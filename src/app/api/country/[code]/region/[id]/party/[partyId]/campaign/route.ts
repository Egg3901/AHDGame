import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { spendPoliticalStrength } from "@/lib/parties/commands/spendPoliticalStrength";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { canSpendOnStateParty } from "@/lib/parties/access";
import {
  applyCampaignBoost,
  CAMPAIGN_BOOST_PER_ACTION,
  CAMPAIGN_SELF_EFFICIENCY,
  CAMPAIGN_ALLY_EFFICIENCY,
} from "@/lib/redistricting/campaignBoost";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type {
  CongressionalDistrict,
  Election,
  ElectionCandidate,
  StatePartyOrg,
} from "@/lib/db/types";

const BodySchema = z.object({ districtIndex: z.number().int().min(1) });
const CAMPAIGN_BASE_PS_COST = 2;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase();
    const stateId = id.toUpperCase();
    if (!(countryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const character = auth.user.character;

    const db = await getDb();
    if (!isRedistrictingEnabled(await getGameState(db))) {
      return NextResponse.json({ error: "Redistricting is not enabled" }, { status: 404 });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const districtIndex = parsed.data.districtIndex;

    const party = await findPartyBySequentialId(db, partyId, countryId as CountryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const spo = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ countryId: countryId as CountryId, stateId, partyId: String(party.sequentialId) });
    if (!canSpendOnStateParty(party, spo, auth.user)) {
      return NextResponse.json(
        { error: "Not authorized to campaign for this party here" },
        { status: 403 }
      );
    }

    // Active house race for this state.
    const election = await db.collection<Election>("elections").findOne({
      countryId: countryId as CountryId,
      state: stateId,
      electionType: "house",
      status: { $in: ["active", "upcoming"] },
    });
    if (!election) {
      return NextResponse.json({ error: "No active House race here" }, { status: 400 });
    }

    // The target district must actually exist in this state's map.
    const districtCount = await db
      .collection<CongressionalDistrict>("congressionalDistricts")
      .countDocuments({ countryId: countryId as CountryId, stateId });
    if (districtCount === 0 || districtIndex > districtCount) {
      return NextResponse.json({ error: "District does not exist" }, { status: 400 });
    }

    // Efficiency: is the actor an active candidate in this race?
    const isCandidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({ electionId: election._id, characterId: character._id, status: "active" });
    const efficiency = isCandidate ? CAMPAIGN_SELF_EFFICIENCY : CAMPAIGN_ALLY_EFFICIENCY;

    const gs = await getGameState(db);
    const spend = await spendPoliticalStrength(
      {
        countryId: countryId as CountryId,
        partyId: String(party.sequentialId),
        scope: "state",
        stateId,
        baseCost: CAMPAIGN_BASE_PS_COST,
        action: "campaign-here",
        now: new Date(),
        turn: gs?.currentTurn ?? 0,
      },
      db
    );
    if (!spend.ok) {
      return NextResponse.json(
        {
          error:
            spend.reason === "insufficient-ps" ? "Insufficient political strength" : spend.reason,
        },
        { status: 400 }
      );
    }

    // Accumulate the boost (capped).
    const key = `districtCampaignBoosts.${districtIndex}.${party.sequentialId}`;
    const current =
      election.districtCampaignBoosts?.[String(districtIndex)]?.[String(party.sequentialId)] ?? 0;
    const next = applyCampaignBoost(current, CAMPAIGN_BOOST_PER_ACTION * efficiency);
    await db
      .collection<Election>("elections")
      .updateOne({ _id: election._id }, { $set: { [key]: next, updatedAt: new Date() } });

    return NextResponse.json({ ok: true, boost: next, psCost: spend.effectiveCost, efficiency });
  } catch (error) {
    return handleRouteError(error);
  }
}
