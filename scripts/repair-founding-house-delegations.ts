/**
 * Founding-election repair: re-resolve the US House under one-winner primaries.
 *
 * At the founding general (cycle 0) US House primaries advanced the top 3 per
 * party, so a party's own filler NPP reached the general alongside the player
 * who beat it and took a slice of the state's delegation. No founding race
 * ever stamped `primaryResults`, so that slice was sized by GENERAL vote share.
 *
 * Repair: collapse each party's founding votes onto its single nominee (the
 * player where one ran, otherwise the party's NPP) and re-run the real
 * resolver. Collapsing WITHIN a party leaves the party's aggregate vote
 * untouched, so `computePartyBaselines` yields identical quotas — which
 * districts each party holds does not move, only who inside the party holds
 * them. Four races had the NPP ahead at the primary deadline; the call was to
 * side with the player in all of them, so primary standing is reported but
 * does not gate the merge.
 *
 * Also repairs collateral damage: every `congressionalDistricts` doc carries
 * its holder in `holderCharacterId` with `holderNppId` null, including NPP
 * holders whose ids live in `npps`. Those seats resolve against `characters`,
 * find nothing, and render unheld. The resolver writes both fields correctly.
 *
 * REQUIRES the read-path fix (districtedHouseResolution `persist`) to be live
 * first. While the live "Projected Seats" panel still writes holders, any
 * repair here is overwritten the next time someone opens a House race page.
 *
 * Writes a pre-image to scripts/.founding-house-repair-backup.json.
 *
 *   npx tsx scripts/repair-founding-house-delegations.ts            # dry run
 *   npx tsx scripts/repair-founding-house-delegations.ts --apply    # write
 */
import { config } from "dotenv";
config({ path: process.env.AHD_ENV_FILE || ".env.local" });
import { MongoClient, ObjectId } from "mongodb";
import { writeFileSync } from "fs";
import { resolve as resolvePath } from "path";
import { districtedHouseResolution } from "@/lib/redistricting/districtedHouseResolution";

const BACKUP_PATH = resolvePath(__dirname, ".founding-house-repair-backup.json");

interface Entry {
  id: string;
  characterName: string;
  isNPP: boolean;
  characterId: ObjectId | null;
  nppId: ObjectId | null;
  party: string;
  votes: number;
  seats: number;
  primaryVotes: number;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await MongoClient.connect(process.env.MONGODB_URI!, { directConnection: true });
  const db = client.db();
  const now = new Date();

  const elections = await db
    .collection("elections")
    .find({ electionType: "house", countryId: "US", cycle: 0 })
    .sort({ state: 1 })
    .toArray();

  console.log(`${apply ? "APPLYING" : "DRY RUN"} — ${elections.length} founding US House races\n`);

  const backup: Record<string, unknown>[] = [];
  const merges: string[] = [];
  const problems: string[] = [];
  let seatsMovedToPlayers = 0;

  for (const election of elections) {
    const state = election.state as string;
    const tally = await db.collection("electionVoteTallies").findOne({ electionId: election._id });
    if (!tally) {
      problems.push(`${state}: no tally`);
      continue;
    }
    const candidates = await db
      .collection("electionCandidates")
      .find({ electionId: election._id })
      .toArray();
    const primarySnap = (tally.turnSnapshots ?? []).find(
      (s: { turn: number }) => s.turn === election.primaryEndTurn
    );

    // Group the founding field by party, dropping phantom (zero-vote) entries.
    const byParty = new Map<string, Entry[]>();
    for (const cand of candidates) {
      const id = String(cand._id);
      const votes = tally.totalVotes?.[id] ?? 0;
      if (votes <= 0) continue;
      const list = byParty.get(cand.party) ?? [];
      list.push({
        id,
        characterName: cand.characterName,
        isNPP: !!cand.isNPP,
        characterId: cand.isNPP ? null : (cand.characterId ?? null),
        nppId: cand.isNPP ? (cand.nppId ?? null) : null,
        party: cand.party,
        votes,
        seats: tally.seatsEstimate?.[id] ?? 0,
        primaryVotes: primarySnap?.cumulativeVotes?.[id] ?? 0,
      });
      byParty.set(cand.party, list);
    }

    // One nominee per party: the player if one ran, else the leading NPP.
    const candidateVotes: Record<string, number> = {};
    const candidateParty: Record<string, string> = {};
    const candidateCharacterId: Record<string, string | null> = {};
    const candidateNppId: Record<string, string | null> = {};
    const nomineeByParty = new Map<string, { nominee: Entry; partySeats: number }>();
    let hasMerge = false;
    let skipState = false;

    for (const [party, list] of byParty) {
      const players = list.filter((x) => !x.isNPP);
      if (players.length > 1) {
        // Two players in one party means one of them has to lose seats. That is
        // a different call, so the state is left alone and reported.
        problems.push(`${state} party${party}: ${players.length} players — STATE SKIPPED`);
        skipState = true;
        break;
      }
      const byPrimary = [...list].sort((a, b) => b.primaryVotes - a.primaryVotes);
      const nominee = players[0] ?? byPrimary[0];
      const partyVotes = list.reduce((sum, x) => sum + x.votes, 0);
      const partySeats = list.reduce((sum, x) => sum + x.seats, 0);

      if (list.length > 1) {
        hasMerge = true;
        merges.push(
          `  ${state} party${party}: ${nominee.characterName}${nominee.isNPP ? " (NPP)" : ""} ` +
            `${nominee.seats} -> ${partySeats}` +
            (byPrimary[0].id === nominee.id ? "" : "   [lost the primary; siding with the player]")
        );
        if (!nominee.isNPP) seatsMovedToPlayers += partySeats - nominee.seats;
      }

      candidateVotes[nominee.id] = partyVotes;
      candidateParty[nominee.id] = party;
      candidateCharacterId[nominee.id] = nominee.characterId ? String(nominee.characterId) : null;
      candidateNppId[nominee.id] = nominee.nppId ? String(nominee.nppId) : null;
      nomineeByParty.set(party, { nominee, partySeats });
    }
    if (skipState) continue;

    const districtsBefore = await db
      .collection("congressionalDistricts")
      .find({ countryId: "US", stateId: state })
      .toArray();
    const officialsBefore = await db
      .collection("electedOfficials")
      .find({ officeType: "house", countryId: "US", state })
      .toArray();

    backup.push({
      state,
      electionId: String(election._id),
      districts: districtsBefore.map((d) => ({
        _id: d._id,
        holderCharacterId: d.holderCharacterId ? String(d.holderCharacterId) : null,
        holderNppId: d.holderNppId ? String(d.holderNppId) : null,
        holderParty: d.holderParty ?? null,
      })),
      electedOfficials: officialsBefore,
      seatsEstimate: tally.seatsEstimate ?? null,
    });

    if (!apply) {
      const unresolvable = districtsBefore.filter((d) => d.holderCharacterId && !d.holderNppId);
      console.log(
        `${state}: ${nomineeByParty.size} nominees, ${districtsBefore.length} districts` +
          `, holders to rewrite ${unresolvable.length}` +
          (hasMerge ? "   [delegation merge]" : "")
      );
      continue;
    }

    // Re-resolve with the shipped engine. One nominee per party, so
    // `primaryShares` is moot and the whole party quota lands on them.
    const result = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: state,
      candidateVotes,
      candidateParty,
      candidateCharacterId,
      candidateNppId,
      primaryShares: null,
      districtBoosts: election.districtCampaignBoosts,
      now,
      persist: true,
    });
    if (!result) {
      problems.push(`${state}: resolver returned null (no district docs)`);
      continue;
    }

    // Rewrite electedOfficials from the result.
    await db
      .collection("electedOfficials")
      .deleteMany({ officeType: "house", countryId: "US", state });
    for (const [candidateId, seats] of result.winners) {
      const party = candidateParty[candidateId];
      const nominee = nomineeByParty.get(party)!.nominee;
      await db.collection("electedOfficials").insertOne({
        officeType: "house",
        countryId: "US",
        state,
        isAppointment: false,
        seatsHeld: seats,
        characterId: nominee.characterId,
        characterName: nominee.characterName,
        party,
        isNPP: nominee.isNPP,
        nppId: nominee.nppId,
        electedAt: election.endTime ?? now,
        createdAt: now,
        updatedAt: now,
      });

      if (nominee.isNPP && nominee.nppId) {
        await db
          .collection("npps")
          .updateOne(
            { _id: nominee.nppId },
            { $set: { currentOffice: { type: "house", state, seatsHeld: seats }, updatedAt: now } }
          );
      } else if (nominee.characterId) {
        await db.collection("characters").updateOne(
          {
            _id: nominee.characterId,
            "currentOffice.type": "house",
            "currentOffice.state": state,
          },
          { $set: { "currentOffice.seatsHeld": seats, updatedAt: now } }
        );
      }
    }

    // Clear currentOffice for the co-nominees this repair unseats.
    for (const [party, list] of byParty) {
      const keptId = nomineeByParty.get(party)!.nominee.id;
      for (const entry of list) {
        if (entry.id === keptId) continue;
        const officeFilter = { "currentOffice.type": "house", "currentOffice.state": state };
        if (entry.nppId) {
          await db
            .collection("npps")
            .updateOne(
              { _id: entry.nppId, ...officeFilter },
              { $set: { currentOffice: null, updatedAt: now } }
            );
        } else if (entry.characterId) {
          await db
            .collection("characters")
            .updateOne(
              { _id: entry.characterId, ...officeFilter },
              { $set: { currentOffice: null, updatedAt: now } }
            );
        }
      }
    }

    // The founding tally's seat estimate, so the results page agrees.
    await db
      .collection("electionVoteTallies")
      .updateOne({ electionId: election._id }, { $set: { seatsEstimate: result.seatsEstimate } });

    const seated = result.winners.reduce((sum, [, n]) => sum + n, 0);
    const expected = (election.totalSeats as number) ?? districtsBefore.length;
    if (seated !== expected) problems.push(`${state}: seated ${seated} vs totalSeats ${expected}`);
    console.log(
      `${state}: seated ${seated}/${expected} ${seated === expected ? "OK" : "MISMATCH"}` +
        (hasMerge ? "   [delegation merge]" : "")
    );
  }

  writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));

  console.log("\ndelegation merges:");
  for (const line of merges) console.log(line);
  console.log(`\nseats moved to players: ${seatsMovedToPlayers}`);
  console.log(`pre-image written to ${BACKUP_PATH}`);

  if (apply) {
    const unheld = await db
      .collection("congressionalDistricts")
      .countDocuments({ countryId: "US", holderCharacterId: null, holderNppId: null });
    const stillBroken = await db
      .collection("congressionalDistricts")
      .countDocuments({ countryId: "US", holderNppId: null, holderCharacterId: { $ne: null } });
    console.log(`unheld districts: ${unheld}`);
    console.log(`districts held by a character (rest are NPP-held): ${stillBroken}`);
  }

  if (problems.length) {
    console.log("\nPROBLEMS:");
    for (const p of problems) console.log("  " + p);
  }

  await client.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
