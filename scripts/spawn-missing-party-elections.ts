/**
 * Spawn missing statePartyOrg entries + state party elections on the live server.
 *
 * Finds all country+region+party combos that should exist but are missing
 * statePartyOrg entries, creates the orgs, then creates elections with the
 * same timing as the existing national party elections for that party.
 *
 * Usage:  npx tsx scripts/spawn-missing-party-elections.ts [--dry-run]
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

const DRY_RUN = process.argv.includes("--dry-run");

const ALL_POSITIONS = ["chair", "viceChair", "treasurer"] as const;
type Position = (typeof ALL_POSITIONS)[number];

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log("Connected to LIVE MongoDB");

  const db = client.db("a-house-divided");

  // 1. Get current turn
  const gameState = await db.collection("gameState").findOne({ _id: "current" as any });
  if (!gameState) throw new Error("No gameState found");
  const currentTurn: number = gameState.currentTurn;
  console.log(`Current turn: ${currentTurn}`);

  // 2. Load data
  const [regions, parties, statePartyOrgs, activeStateElections, activeNationalElections] =
    await Promise.all([
      db.collection("states").find({}).toArray(),
      db.collection("politicalParties").find({}).toArray(),
      db.collection("statePartyOrg").find({}).toArray(),
      db.collection("statePartyElections").find({ status: "voting" }).toArray(),
      db.collection("nationalPartyElections").find({ status: "voting" }).toArray(),
    ]);

  console.log(`Regions: ${regions.length}`);
  console.log(`Parties: ${parties.length}`);
  console.log(`StatePartyOrgs: ${statePartyOrgs.length}`);
  console.log(`Active state elections: ${activeStateElections.length}`);
  console.log(`Active national elections: ${activeNationalElections.length}`);

  // Build lookup structures — use stateId:partyId as key since some orgs are missing countryId
  const orgByKey = new Map<string, any>();
  for (const o of statePartyOrgs) {
    orgByKey.set(`${o.stateId}:${o.partyId}`, o);
  }

  const partiesByCountry = new Map<string, any[]>();
  for (const p of parties) {
    const cid = p.countryId ?? "US";
    if (!partiesByCountry.has(cid)) partiesByCountry.set(cid, []);
    partiesByCountry.get(cid)!.push(p);
  }

  const regionsByCountry = new Map<string, any[]>();
  for (const r of regions) {
    const cid = r.countryId ?? "US";
    if (!regionsByCountry.has(cid)) regionsByCountry.set(cid, []);
    regionsByCountry.get(cid)!.push(r);
  }

  // National elections keyed by countryId:partyId — for timing
  const nationalElectionMap = new Map<string, any>();
  for (const ne of activeNationalElections) {
    const key = `${ne.countryId ?? "US"}:${ne.partyId}`;
    if (!nationalElectionMap.has(key)) {
      nationalElectionMap.set(key, ne);
    }
  }

  // 3. Find missing statePartyOrg entries AND orgs with missing countryId
  const missingOrgs: { stateId: string; partyId: string; countryId: string }[] = [];
  const orgsNeedingCountryId: { stateId: string; partyId: string; countryId: string }[] = [];

  for (const [cid, cParties] of partiesByCountry) {
    const cRegions = regionsByCountry.get(cid) ?? [];
    for (const region of cRegions) {
      for (const party of cParties) {
        const pid = String(party.sequentialId);
        const key = `${region._id}:${pid}`;
        const existingOrg = orgByKey.get(key);
        if (!existingOrg) {
          missingOrgs.push({ stateId: region._id, partyId: pid, countryId: cid });
        } else if (!existingOrg.countryId) {
          // Org exists but is missing countryId — needs fix
          orgsNeedingCountryId.push({ stateId: region._id, partyId: pid, countryId: cid });
        }
      }
    }
  }

  console.log(`\nMissing statePartyOrg entries: ${missingOrgs.length}`);
  for (const m of missingOrgs) {
    const nationalKey = `${m.countryId}:${m.partyId}`;
    const natEl = nationalElectionMap.get(nationalKey);
    const timing = natEl
      ? `startTurn=${natEl.startTurn} endTurn=${natEl.endTurn}`
      : "NO NATIONAL ELECTION";
    console.log(`  ${m.countryId}:${m.stateId} party=${m.partyId} — ${timing}`);
  }

  console.log(`\nOrgs needing countryId fix: ${orgsNeedingCountryId.length}`);
  for (const m of orgsNeedingCountryId) {
    console.log(`  ${m.stateId}_${m.partyId} → countryId="${m.countryId}"`);
  }

  if (missingOrgs.length === 0 && orgsNeedingCountryId.length === 0) {
    console.log("No missing orgs. Checking for missing elections on existing orgs...");
  }

  // 4. Also find existing orgs that are missing elections
  // Use stateId_partyId_position as key (countryId-agnostic to catch legacy entries)
  const activeElectionSet = new Set(
    activeStateElections.map((e: any) => `${e.stateId}_${e.partyId}_${e.position}`)
  );

  const partySet = new Set(parties.map((p: any) => String(p.sequentialId)));
  const missingElectionsForExistingOrgs: {
    stateId: string;
    partyId: string;
    countryId: string;
    position: Position;
  }[] = [];

  for (const org of statePartyOrgs) {
    if (!partySet.has(org.partyId)) continue;
    const cid = org.countryId ?? "US";
    for (const position of ALL_POSITIONS) {
      const key = `${org.stateId}_${org.partyId}_${position}`;
      if (!activeElectionSet.has(key)) {
        missingElectionsForExistingOrgs.push({
          stateId: org.stateId,
          partyId: org.partyId,
          countryId: cid,
          position,
        });
      }
    }
  }

  if (missingElectionsForExistingOrgs.length > 0) {
    console.log(`\nExisting orgs missing elections: ${missingElectionsForExistingOrgs.length}`);
    for (const m of missingElectionsForExistingOrgs) {
      console.log(`  ${m.countryId}:${m.stateId} party=${m.partyId} pos=${m.position}`);
    }
  }

  const totalWork =
    missingOrgs.length + orgsNeedingCountryId.length + missingElectionsForExistingOrgs.length;

  if (totalWork === 0) {
    console.log("Nothing to do!");
    await client.close();
    return;
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes made.");
    await client.close();
    return;
  }

  const now = new Date();

  // 5a. Fix existing orgs missing countryId
  if (orgsNeedingCountryId.length > 0) {
    for (const m of orgsNeedingCountryId) {
      await db
        .collection("statePartyOrg")
        .updateOne(
          { _id: `${m.stateId}_${m.partyId}` as any },
          { $set: { countryId: m.countryId, updatedAt: now } }
        );
    }
    console.log(`\nFixed countryId on ${orgsNeedingCountryId.length} statePartyOrg entries.`);
  }

  // 5b. Create truly missing statePartyOrg entries
  if (missingOrgs.length > 0) {
    const orgDocs = missingOrgs.map((m) => ({
      _id: `${m.stateId}_${m.partyId}`,
      stateId: m.stateId,
      partyId: m.partyId,
      countryId: m.countryId,
      organization: 0,
      organizationCap: 15,
      momentum: 0,
      treasury: 0,
      stateTaxRate: 5,
      actionPool: 100,
      hasPresence: false,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      consecutiveLosses: 0,
      capContributions: {},
      createdAt: now,
      updatedAt: now,
    }));

    const orgResult = await db.collection("statePartyOrg").insertMany(orgDocs as any);
    console.log(`Inserted ${orgResult.insertedCount} statePartyOrg entries.`);
  }

  // 6. Create elections for ALL missing combos (new orgs + existing orgs missing elections)
  const allMissingElections: {
    stateId: string;
    partyId: string;
    countryId: string;
    position: Position;
  }[] = [];

  // From new orgs: all 3 positions each
  for (const m of missingOrgs) {
    for (const position of ALL_POSITIONS) {
      allMissingElections.push({ ...m, position });
    }
  }

  // From orgs that had missing countryId: check if they also need elections
  for (const m of orgsNeedingCountryId) {
    for (const position of ALL_POSITIONS) {
      const key = `${m.stateId}_${m.partyId}_${position}`;
      if (!activeElectionSet.has(key)) {
        allMissingElections.push({ ...m, position });
      }
    }
  }

  // From existing orgs missing elections
  allMissingElections.push(...missingElectionsForExistingOrgs);

  if (allMissingElections.length > 0) {
    const electionDocs = allMissingElections.map((m) => {
      const nationalKey = `${m.countryId}:${m.partyId}`;
      const natEl = nationalElectionMap.get(nationalKey);

      const startTurn = natEl ? natEl.startTurn : currentTurn;
      const endTurn = natEl ? natEl.endTurn : currentTurn + 96;
      const durationTurns = natEl ? natEl.durationTurns : 96;

      const msUntilEnd = (endTurn - currentTurn) * 60 * 60 * 1000;
      const endTime = new Date(now.getTime() + msUntilEnd);
      const msUntilStart = (startTurn - currentTurn) * 60 * 60 * 1000;
      const startTime = new Date(now.getTime() + msUntilStart);

      return {
        stateId: m.stateId,
        partyId: m.partyId,
        countryId: m.countryId,
        position: m.position,
        status: "voting" as const,
        startTime,
        endTime,
        startTurn,
        endTurn,
        durationTurns,
        winnerId: null,
        createdAt: now,
        updatedAt: now,
      };
    });

    const elResult = await db.collection("statePartyElections").insertMany(electionDocs);
    console.log(`Inserted ${elResult.insertedCount} state party elections.`);
  }

  await client.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
