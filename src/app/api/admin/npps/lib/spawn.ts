import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { calculateQualityBonus } from "@/lib/npp/generator";
import { NPP_ECONOMY_DEFAULTS } from "@/lib/npp/economyDefaults";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import type { NPP, StatePartyOrg, State, PoliticalParty } from "@/lib/db/types";
import type { Db } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";

export async function handleSpawnNPPs(
  db: Db,
  body: {
    count?: number;
    party?: string;
    countryId?: string;
    preferMode?: "lean" | "members" | "both";
  }
): Promise<NextResponse> {
  const { count, party, countryId, preferMode = "both" } = body;

  if (!count || count < 1 || count > 500) {
    return NextResponse.json({ error: "count must be between 1 and 500." }, { status: 400 });
  }
  if (!party) {
    return NextResponse.json({ error: "party is required." }, { status: 400 });
  }

  const allStatesRaw = await db.collection<State>("states").find({}).toArray();

  // Look up party by sequentialId and countryId for precise matching
  let partyDoc: PoliticalParty | null = null;
  const seqId = parseInt(party, 10);
  if (!isNaN(seqId)) {
    if (countryId) {
      // Use explicit countryId for precise lookup (sequentialId is only unique within a country)
      partyDoc = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: seqId, countryId: countryId.toUpperCase() as CountryId });
    } else {
      // No countryId provided - check if sequentialId is unambiguous
      const matchingParties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ sequentialId: seqId })
        .toArray();
      if (matchingParties.length === 1) {
        partyDoc = matchingParties[0];
      } else if (matchingParties.length > 1) {
        return NextResponse.json(
          {
            error: `Multiple parties have sequentialId ${seqId}. Please specify countryId.`,
          },
          { status: 400 }
        );
      }
    }
  }

  if (!partyDoc) {
    return NextResponse.json({ error: "Party not found." }, { status: 400 });
  }

  // Use party's country for state filtering (more reliable than input countryId)
  const partyCountryId = partyDoc.countryId;
  // Always use sequentialId string as the canonical party identifier
  const partyIdStr = String(partyDoc.sequentialId);

  // Only consider states belonging to the same country as the party
  const allStates = allStatesRaw.filter((s) => s.countryId === partyCountryId);

  if (allStates.length === 0) {
    return NextResponse.json({ error: "No states found in database." }, { status: 400 });
  }

  const partyEcon =
    partyDoc?.economicPosition ?? (party === "democrat" ? -2 : party === "republican" ? 2 : 0);
  const partySoc =
    partyDoc?.socialPosition ?? (party === "democrat" ? -2 : party === "republican" ? 2 : 0);

  const nppMemberAgg = await db
    .collection("electedOfficials")
    .aggregate<{ _id: string; count: number }>([
      { $match: { isNPP: true } },
      { $lookup: { from: "npps", localField: "nppId", foreignField: "_id", as: "npp" } },
      { $unwind: "$npp" },
      { $match: { "npp.party": partyIdStr } },
      { $group: { _id: "$state", count: { $sum: 1 } } },
    ])
    .toArray();

  const membersByState = new Map(nppMemberAgg.map((r) => [r._id as string, r.count]));

  const { getStateLean } = await import("@/lib/utils/demographics");

  const weights: { state: string; weight: number }[] = allStates.map((s) => {
    const stateAbbr = s._id as string;
    const stateLean = getStateLean(s);
    const leanDist = Math.abs(stateLean - partyEcon);
    const leanScore = Math.max(0, 1 - leanDist / 10);

    const memberCount = membersByState.get(stateAbbr) ?? 0;
    const memberScore = memberCount > 0 ? Math.log2(memberCount + 1) / Math.log2(11) : 0;

    let weight: number;
    if (preferMode === "lean") weight = leanScore;
    else if (preferMode === "members") weight = memberScore + 0.05;
    else weight = leanScore * 0.6 + memberScore * 0.4;

    return { state: stateAbbr, weight: Math.max(0.01, weight) };
  });

  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

  function pickState(): string {
    let r = Math.random() * totalWeight;
    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.state;
    }
    return weights[weights.length - 1].state;
  }

  const existingNPPs = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null }, { projection: { name: 1 } })
    .toArray();
  const usedNames = new Set(existingNPPs.map((n) => n.name));

  const { generateUniqueNPPName } = await import("@/lib/npp/nameGenerator");

  const created: { state: string; name: string }[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const state = pickState();

    const statePartyKey = `${state}_${partyIdStr}`;
    const orgDoc = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });
    const partyOrg = orgDoc?.organization ?? 50;
    const quality = calculateQualityBonus(partyOrg);

    const name = generateUniqueNPPName([...usedNames], 100, partyCountryId);
    if (!name) continue;
    usedNames.add(name);

    const stateDoc = allStates.find((s) => (s._id as string) === state);
    const stateLeanVal = stateDoc ? getStateLean(stateDoc) : 0;
    const blendEcon = partyEcon * 0.7 + stateLeanVal * 0.3;
    const variance = Math.max(0.4, 1.5 - (quality + 20) / 25);
    const economic = Math.max(
      -5,
      Math.min(5, Math.round((blendEcon + (Math.random() * 2 - 1) * variance) * 10) / 10)
    );
    const social = Math.max(
      -5,
      Math.min(5, Math.round((partySoc + (Math.random() * 2 - 1) * variance) * 10) / 10)
    );

    // Assign sequential ID
    const sequentialId = await getNextSequentialId(db, "npp");

    const npp: NPP = {
      _id: new ObjectId(),
      name,
      countryId: partyCountryId as "US" | "UK",
      homeState: state,
      politicalInfluence: 10,
      favorability: Math.round(
        Math.max(20, Math.min(80, 50 + quality * 0.2 + (Math.random() * 20 - 10)))
      ),
      policies: { economic, social },
      party: partyIdStr,
      currentOffice: null,
      // Economy fields via the shared SSOT — admin-spawned NPPs match the donor
      // base 1 (with funds/AP initialized) of generated/seeded ones.
      ...NPP_ECONOMY_DEFAULTS,
      personality: {
        loyalty: Math.round(
          Math.max(0, Math.min(100, 50 + quality * 0.3 + (Math.random() * 40 - 20)))
        ),
        ambition: Math.round(Math.max(0, Math.min(100, Math.random() * 60 + 20))),
        stubbornness: Math.round(
          Math.max(0, Math.min(100, 40 - quality * 0.15 + (Math.random() * 40 - 20)))
        ),
      },
      generatedAt: now,
      retiredAt: null,
      influenceState: { totalTimesInfluenced: 0 },
      sequentialId,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<NPP>("npps").insertOne(npp);
    created.push({ state, name });
  }

  const byState: Record<string, number> = {};
  for (const { state } of created) byState[state] = (byState[state] ?? 0) + 1;
  const topStates = Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return NextResponse.json({
    message: `Spawned ${created.length} NPP${created.length !== 1 ? "s" : ""} for the ${partyDoc?.name ?? party} party.`,
    spawned: created.length,
    topStates: topStates.map(([state, n]) => ({ state, count: n })),
  });
}
