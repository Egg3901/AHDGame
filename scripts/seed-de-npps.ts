/**
 * Seed DE NPPs — generates Non-Player Politicians for all German Bundesländer.
 *
 * Target counts are proportional to 2021 Bundestag Zweitstimmen results.
 * CSU is constrained to Bayern (BY) only, matching the real party's scope.
 * Run after seed-de.ts (requires parties + statePartyOrg to exist).
 *
 * Usage:
 *   npx tsx scripts/seed-de-npps.ts
 */

import { ObjectId } from "mongodb";
import { connectDb, closeDb } from "./utils/db";
import type { NPP, PoliticalParty, StatePartyOrg, State } from "../src/lib/db/types";
import { getNextSequentialId } from "../src/lib/db/sequentialId";
import { generateUniqueNPPNameAndGender } from "../src/lib/npp/nameGenerator";

// 2021 Bundestag proportional NPP targets per party (seq ID: count)
// CSU limited to BY; others spread across all 16 Länder.
const PARTY_TARGETS: Array<{ seqId: number; count: number; statesOnly?: string[] }> = [
  { seqId: 1, count: 57 }, // SPD
  { seqId: 2, count: 40 }, // CDU
  { seqId: 3, count: 12, statesOnly: ["BY"] }, // CSU — Bavaria only
  { seqId: 4, count: 33 }, // Greens
  { seqId: 5, count: 25 }, // FDP
  { seqId: 6, count: 11 }, // Die Linke
  { seqId: 7, count: 23 }, // AfD
];

function getStateLean(state: State): number {
  return state.cachedEconomicLean ?? 0;
}

function weightedPick<T>(items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

async function main() {
  console.log("=== DE NPP Seed Script ===\n");
  const db = await connectDb();

  const deStates = await db.collection<State>("states").find({ countryId: "DE" }).toArray();

  if (deStates.length === 0) {
    console.error("No DE states found. Run seed-de.ts first.");
    process.exit(1);
  }

  const deParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "DE" })
    .toArray();

  const existingNPPs = await db
    .collection<NPP>("npps")
    .find({ countryId: "DE", retiredAt: null })
    .toArray();

  console.log(`Found ${existingNPPs.length} existing DE NPPs (will skip duplicates).`);
  const usedNames = new Set(
    (
      await db
        .collection<NPP>("npps")
        .find({}, { projection: { name: 1 } })
        .toArray()
    ).map((n) => n.name)
  );

  const now = new Date();
  let totalCreated = 0;

  for (const target of PARTY_TARGETS) {
    const party = deParties.find((p) => p.sequentialId === target.seqId);
    if (!party) {
      console.warn(`  Party seq ${target.seqId} not found — skipping.`);
      continue;
    }

    const partyIdStr = String(party.sequentialId);
    const partyEcon = party.economicPosition ?? 0;
    const partySoc = party.socialPosition ?? 0;

    const eligibleStates = target.statesOnly
      ? deStates.filter((s) => target.statesOnly!.includes(s._id as string))
      : deStates;

    // Weight each state by (1 - |state_lean - party_econ| / 10) + party org strength
    const stateWeights = await Promise.all(
      eligibleStates.map(async (s) => {
        const stateId = s._id as string;
        const stateLean = getStateLean(s);
        const leanDist = Math.abs(stateLean - partyEcon);
        const leanScore = Math.max(0.05, 1 - leanDist / 10);

        const org = await db
          .collection<StatePartyOrg>("statePartyOrg")
          .findOne({ _id: `${stateId}_${partyIdStr}` });
        const orgScore = ((org?.organization ?? 50) / 100) * 0.3;

        return { value: stateId, weight: leanScore * 0.7 + orgScore };
      })
    );

    let created = 0;

    for (let i = 0; i < target.count; i++) {
      const stateId = weightedPick(stateWeights);

      const org = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .findOne({ _id: `${stateId}_${partyIdStr}` });
      const partyOrg = org?.organization ?? 50;
      const quality = Math.max(-20, Math.min(20, (partyOrg - 50) / 2.5));

      const nameResult = generateUniqueNPPNameAndGender([...usedNames], 100, "DE");
      if (!nameResult) {
        console.warn(`  Could not generate unique name for ${party.name} in ${stateId}`);
        continue;
      }
      const { name, gender } = nameResult;
      usedNames.add(name);

      const stateLeanVal = eligibleStates.find((s) => (s._id as string) === stateId)
        ? getStateLean(eligibleStates.find((s) => (s._id as string) === stateId)!)
        : 0;
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

      const sequentialId = await getNextSequentialId(db, "npp");

      const npp: NPP = {
        _id: new ObjectId(),
        name,
        countryId: "DE",
        homeState: stateId,
        politicalInfluence: 10,
        favorability: Math.round(
          Math.max(20, Math.min(80, 50 + quality * 0.2 + (Math.random() * 20 - 10)))
        ),
        policies: { economic, social },
        party: partyIdStr,
        currentOffice: null,
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
        electionCooldowns: {},
        sequentialId,
        createdAt: now,
        updatedAt: now,
        gender: gender as "male" | "female",
      };

      await db.collection<NPP>("npps").insertOne(npp);
      usedNames.add(name);
      created++;
      totalCreated++;
    }

    console.log(`  ✓ ${party.name} (seq ${target.seqId}): ${created} NPPs created`);
  }

  // Seed Federal President (Frank-Walter Steinmeier)
  console.log("\nSeeding Federal President NPP...");
  const presidentId = new ObjectId("6770000000000000000000c1");
  const existingPresident = await db.collection<NPP>("npps").findOne({ _id: presidentId });
  if (existingPresident) {
    console.log("  Federal President already seeded — skipping.");
  } else {
    const presidentSeqId = await getNextSequentialId(db, "npp");
    const presidentDoc: NPP = {
      _id: presidentId,
      countryId: "DE",
      name: "Frank-Walter Steinmeier",
      homeState: "BE",
      politicalInfluence: 0,
      favorability: 55,
      policies: { economic: 0, social: 0 },
      party: "independent",
      currentOffice: null,
      personality: { loyalty: 50, ambition: 0, stubbornness: 50 },
      generatedAt: now,
      retiredAt: now,
      influenceState: { totalTimesInfluenced: 0 },
      electionCooldowns: {},
      sequentialId: presidentSeqId,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .collection<NPP>("npps")
      .updateOne({ _id: presidentId }, { $set: presidentDoc }, { upsert: true });
    totalCreated++;
    console.log("  ✓ Frank-Walter Steinmeier (Federal President) seeded.");
  }

  console.log(`\n=== DE NPP Seed Complete: ${totalCreated} NPPs created ===`);
}

main()
  .catch((err) => {
    console.error("DE NPP seed failed:", err);
    process.exit(1);
  })
  .finally(closeDb);
