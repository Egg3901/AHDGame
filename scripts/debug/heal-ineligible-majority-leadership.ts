/**
 * Vacate congressional leadership seats whose holder no longer qualifies under
 * the party gate, and open the replacement elections.
 *
 * WHY THIS EXISTS. President Pro Tempore used to be an `any-seated` office: any
 * senator could win it regardless of party. It is now `largest-single-party`,
 * the same gate the Majority Leader and Majority Whip already had. That change
 * disqualifies anyone currently holding the office from outside the majority
 * party — the live world has at least one, a Pro Tempore sitting as an
 * independent while the Democrats hold sixty seats.
 *
 * WHY THE ENGINE WILL NOT DO IT. `reconcileLeadershipPartyEligibility` only
 * removes a holder it can prove walked away from the qualifying party: it
 * compares their live party against `congressLeaders.party`, the party they
 * qualified under. A holder elected as an independent never moved — the rule
 * moved under them — and from the data that is indistinguishable from the
 * chamber's majority flipping, which is deliberately NOT grounds for vacating.
 * So a rule change that disqualifies sitting officeholders is a migration, and
 * this is it. Running it repeatedly is safe: once a seat is vacant there is
 * nothing left to match.
 *
 * WHAT IT DOES NOT TOUCH. The Speaker and the minority-side roles, whose gates
 * did not change. Only `president_pro_tempore`, `majority_leader_senate`,
 * `majority_whip_senate`, `majority_leader_house` and `majority_whip_house`.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write. Point it at a database with
 * `--live` (MONGODB_URI_LIVE) or leave it on the default MONGODB_URI.
 *
 * `--apply` POSTS TO THE COUNTRY FEED, one "Leadership Vacancy" notice per seat,
 * because it opens the replacement races through the shipped opener rather than
 * a private copy of it. That is deliberate — players should see the same
 * announcement they would have seen had the engine done it — but it means a run
 * against live is player-visible the moment it writes. Check the dry run first.
 *
 * STATUS: NOT RUN.
 */
import { MongoClient, type Db } from "mongodb";
import fs from "node:fs";
import { getPartyMap } from "@/lib/db/partyMap";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { vacateCongressLeadershipRole } from "@/lib/congress/leadershipElections";
import {
  buildChamberLeadershipContext,
  isPartyEligible,
  POLICY_BY_ROLE,
  type ChamberLeadershipContext,
} from "@/lib/congress/leadership/rolePolicy";
import { openElectionsForVacatedMajorityRoles } from "@/lib/congress/leadership/reconcilePartyEligibility";
import { resolveSeatHolderParty } from "@/lib/congress/leadership/openElection";
import type { Character, CongressLeader, ElectedOfficial, LeadershipRole } from "@/lib/db/types";

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");

const GATED: Array<{ leaderRole: LeadershipRole; chamber: "house" | "senate" }> = [
  { leaderRole: "president_pro_tempore", chamber: "senate" },
  { leaderRole: "majority_leader_senate", chamber: "senate" },
  { leaderRole: "majority_whip_senate", chamber: "senate" },
  { leaderRole: "majority_leader_house", chamber: "house" },
  { leaderRole: "majority_whip_house", chamber: "house" },
];

function uri(): string {
  const env = fs.readFileSync(".env.local", "utf8");
  const key = LIVE ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const raw = (env.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!raw) throw new Error(`${key} not found in .env.local`);
  // Railway's Mongo needs a direct connection; replica-set discovery hangs.
  return LIVE ? raw + (raw.includes("?") ? "&" : "?") + "directConnection=true" : raw;
}

async function main(): Promise<void> {
  const client = new MongoClient(uri());
  await client.connect();
  const db = client.db() as unknown as Db;

  try {
    const partyMap = await getPartyMap(db, "US");
    const [senate, house] = await Promise.all([
      getSenateComposition(db, partyMap),
      getHouseComposition(db, partyMap),
    ]);
    const contexts: Record<"house" | "senate", ChamberLeadershipContext> = {
      senate: buildChamberLeadershipContext({
        composition: senate.composition,
        majorityParty: senate.majorityParty,
        majorityBloc: senate.majorityBloc,
      }),
      house: buildChamberLeadershipContext({
        composition: house.composition,
        majorityParty: house.majorityParty,
        majorityBloc: house.majorityBloc,
      }),
    };

    console.log(
      `Senate majority: ${senate.majorityParty ?? "(none)"} | House majority: ${house.majorityParty ?? "(none)"}`
    );
    if (contexts.senate.majorityParty === null || contexts.house.majorityParty === null) {
      console.log("A chamber has no majority party; refusing to act on incomplete composition.");
      return;
    }

    const ineligible: Array<{ leaderRole: LeadershipRole; name: string; party: string }> = [];

    for (const { leaderRole, chamber } of GATED) {
      const leader = await db
        .collection<CongressLeader>("congressLeaders")
        .findOne({ role: leaderRole });
      if (!leader?.characterId) {
        console.log(`  ${leaderRole.padEnd(24)} vacant`);
        continue;
      }
      const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        officeType: chamber,
        $or: [{ characterId: leader.characterId }, { nppId: leader.characterId }],
      });
      if (!seat) {
        // The seat-loss sweep owns this case; leave it alone.
        console.log(`  ${leaderRole.padEnd(24)} ${leader.characterName} holds no ${chamber} seat`);
        continue;
      }
      const char = await db
        .collection<Character>("characters")
        .findOne({ _id: leader.characterId }, { projection: { party: 1 } });
      const party = resolveSeatHolderParty(seat, char);

      if (isPartyEligible(POLICY_BY_ROLE[leaderRole], party, contexts[chamber])) {
        console.log(`  ${leaderRole.padEnd(24)} ${leader.characterName} (${party}) OK`);
        continue;
      }
      console.log(
        `  ${leaderRole.padEnd(24)} ${leader.characterName} (${party ?? "no party"}) INELIGIBLE`
      );
      ineligible.push({
        leaderRole,
        name: leader.characterName,
        party: party ?? "independent",
      });
    }

    if (ineligible.length === 0) {
      console.log("\nNothing to heal.");
      return;
    }
    if (!APPLY) {
      console.log(`\nDRY RUN — would vacate ${ineligible.length} seat(s). Pass --apply to write.`);
      return;
    }

    const now = new Date();
    for (const entry of ineligible) {
      await vacateCongressLeadershipRole(db, entry.leaderRole, now);
      console.log(`  vacated ${entry.leaderRole} (${entry.name})`);
    }

    // The shipped opener, so the races these vacancies create are identical to
    // the ones a party switch produces — same window, same both-anchor write,
    // same feed notice.
    const opened = await openElectionsForVacatedMajorityRoles(
      db,
      ineligible.map((e) => ({ leaderRole: e.leaderRole, formerHolderName: e.name })),
      contexts,
      now
    );
    console.log(`\nOpened ${opened.length} election(s): ${opened.join(", ") || "(none)"}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
