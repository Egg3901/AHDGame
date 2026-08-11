/**
 * Heal: evict genuinely inactive state-party leadership holders (ticket #972).
 *
 * Root cause: state-party leadership elections fire on schedule, but when an
 * election resolves with NO challenger the incumbent is left in place
 * unconditionally — there was no inactivity-based eviction anywhere. So an
 * abandoned chair/vice-chair/treasurer could hold a seat indefinitely. The
 * confirmed case is NJ Democratic (`statePartyOrg _id "NJ_1"`, chair
 * Lachlan Jordan) inactive ~869h while Vice Chair + Treasurer sit vacant.
 *
 * The code fix (`vacateInactiveLeadership` in src/lib/statePartyElections.ts,
 * wired into the turn loop before `createMissingElections`) stops NEW cases
 * from persisting. This script clears the seats that are ALREADY stuck.
 *
 * A seat is stuck when its holder's user fails the lenient activity check
 * `isUserActive(lastActivity, createdAt, now, LEADERSHIP_INACTIVE_TURN_THRESHOLD)`
 * (336 turns ≈ 2 weeks). Data gaps (missing character / user / timestamps) are
 * treated as active and never evicted.
 *
 * Dry-run by default (read-only report). Pass --apply to null the seats and
 * emit the leadership-removed notifications — this DELEGATES to the exact same
 * `vacateInactiveLeadership` helper the turn loop uses, so behavior is identical.
 *
 *   npx tsx scripts/heal-inactive-state-party-leadership.ts           # dry run
 *   npx tsx scripts/heal-inactive-state-party-leadership.ts --apply   # execute
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isUserActive } from "@/lib/players/playerActivity";
import {
  ALL_POSITIONS,
  LEADERSHIP_INACTIVE_TURN_THRESHOLD,
  POSITION_LABELS,
  vacateInactiveLeadership,
} from "@/lib/statePartyElections";
import type { Character, StatePartyElectionPosition, StatePartyOrg, User } from "@/lib/db/types";

const APPLY = process.argv.includes("--apply");
const HOUR_MS = 60 * 60 * 1000;

const POSITION_FIELD: Record<
  StatePartyElectionPosition,
  "chairId" | "viceChairId" | "treasurerId"
> = {
  chair: "chairId",
  viceChair: "viceChairId",
  treasurer: "treasurerId",
};

async function run() {
  const db = await getDb();
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);

  console.log(`MODE: ${APPLY ? "APPLY (will null seats + notify)" : "DRY RUN (read-only)"}`);
  console.log(
    `Threshold: ${LEADERSHIP_INACTIVE_TURN_THRESHOLD} turns (≈ ${Math.round(
      LEADERSHIP_INACTIVE_TURN_THRESHOLD / 24
    )} days). currentTurn=${currentTurn}, now=${now.toISOString()}\n`
  );

  // Read-only enumeration mirroring vacateInactiveLeadership's detection so the
  // report shows exactly which seats --apply would clear.
  const orgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      $or: [
        { chairId: { $ne: null } },
        { viceChairId: { $ne: null } },
        { treasurerId: { $ne: null } },
      ],
    })
    .toArray();

  const holderIdByHex = new Map<string, ObjectId>();
  for (const org of orgs) {
    for (const position of ALL_POSITIONS) {
      const holder = org[POSITION_FIELD[position]];
      if (holder) holderIdByHex.set(holder.toString(), holder);
    }
  }
  const holderIds = Array.from(holderIdByHex.values());

  const characters = holderIds.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: holderIds } })
        .project<{ _id: ObjectId; userId: ObjectId; name?: string }>({ _id: 1, userId: 1, name: 1 })
        .toArray()
    : [];
  const charByHex = new Map(characters.map((c) => [c._id.toString(), c]));

  const userIds = Array.from(
    new Map(characters.filter((c) => c.userId).map((c) => [c.userId.toString(), c.userId])).values()
  );
  const users = userIds.length
    ? await db
        .collection<User>("users")
        .find({ _id: { $in: userIds } })
        .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
          _id: 1,
          lastActivity: 1,
          createdAt: 1,
        })
        .toArray()
    : [];
  const userByHex = new Map(users.map((u) => [u._id.toString(), u]));

  type Stuck = {
    orgId: string;
    stateId: string;
    partyId: string;
    position: StatePartyElectionPosition;
    holderId: string;
    holderName: string;
    lastActivity: string;
    hoursInactive: number;
  };
  const stuck: Stuck[] = [];

  for (const org of orgs) {
    for (const position of ALL_POSITIONS) {
      const holder = org[POSITION_FIELD[position]];
      if (!holder) continue;
      const char = charByHex.get(holder.toString());
      const user = char?.userId ? userByHex.get(char.userId.toString()) : undefined;
      // Skip-on-missing: never punish data gaps (matches vacateInactiveLeadership).
      if (!char?.userId || !user) continue;
      if (
        isUserActive(user.lastActivity, user.createdAt, now, LEADERSHIP_INACTIVE_TURN_THRESHOLD)
      ) {
        continue;
      }
      const ref = user.lastActivity ?? user.createdAt;
      stuck.push({
        orgId: org._id as string,
        stateId: org.stateId,
        partyId: org.partyId,
        position,
        holderId: holder.toString(),
        holderName: char.name ?? "(unknown)",
        lastActivity: ref ? ref.toISOString() : "(none)",
        hoursInactive: ref ? Math.round((now.getTime() - ref.getTime()) / HOUR_MS) : -1,
      });
    }
  }

  if (stuck.length === 0) {
    console.log("No stuck seats found — nothing to heal.");
  } else {
    console.log(`STUCK SEATS — ${stuck.length}:`);
    stuck
      .sort((a, b) => b.hoursInactive - a.hoursInactive)
      .forEach((s) =>
        console.log(
          `  ${s.orgId}  ${POSITION_LABELS[s.position]}  holder=${s.holderName} (${s.holderId})` +
            `  inactive=${s.hoursInactive}h  lastActivity=${s.lastActivity}`
        )
      );
  }

  if (!APPLY) {
    console.log("\nDry run — nothing changed. Re-run with --apply to vacate the stuck seats.");
    return;
  }

  // Delegate the actual mutation + notifications to the shared helper so the
  // heal is byte-identical to what the turn loop does.
  const vacated = await vacateInactiveLeadership(db, currentTurn, now);
  console.log(`\nVacated ${vacated} inactive leadership seat(s).`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
