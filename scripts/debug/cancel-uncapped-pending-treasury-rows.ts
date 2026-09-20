/**
 * Cancel open treasury rows whose amount can never clear the per-player payout cap.
 *
 * WHY THESE EXIST. `POST .../treasury/request` and `POST .../parties/[id]/send`
 * check the party's treasury balance at propose time but NOT the recipient's
 * per-turn payout cap, so a row for any amount can be queued. The cap is only
 * consulted at the very end, inside `executeSendToMember`. By then the approve
 * route has ALREADY claimed the approver's slot atomically (approve/route.ts,
 * the `claim` updateOne) and it returns the refusal without giving that slot
 * back. The row is left `open`, carrying a real approval, and every further
 * Approve click burns the other slot and fails the same way.
 *
 * WHY `amount > cap` IS THE RIGHT TEST. `checkPlayerPayoutCap` refuses when
 * `amount > remaining`, and `remaining` is at most `cap`. So a row whose amount
 * exceeds the flat ceiling is refused on every turn, in every state of the
 * recipient's allowance, no matter how many approvals it collects. It is not a
 * row that is merely waiting for a quieter turn. Approval count is therefore
 * NOT part of the filter: a zero-approval row of the same size is equally
 * unpayable and equally worth clearing off the panel.
 *
 * WHY BOTHER, GIVEN THEY EXPIRE. `expirePendingTransactions` sweeps rows past
 * `expiresAtTurn` (propose + PENDING_TXN_EXPIRY_TURNS = 48) to `"expired"` on
 * the turn path, so these do go away on their own within two days and they
 * never pay out. This script is about the panel in the meantime: officers are
 * looking at rows that read as actionable, clicking Approve, and getting an
 * error that names a cap the request should never have been accepted against.
 *
 * `transfer` rows are excluded. Those move money to a state party, not to a
 * person, and the per-player cap does not apply to them.
 *
 * Writes the same shape the app writes: `cancelPendingTransaction` sets
 * `status: "cancelled"` + `resolvedAt`, and `expirePendingTransactions` also
 * stamps `resolvedAtTurn`. This sets all three.
 *
 * IDEMPOTENT: the update is guarded on `status: "open"`, so a second run is a
 * no-op. DRY RUN BY DEFAULT; `--apply` writes.
 *
 * Usage:
 *   npx tsx scripts/debug/cancel-uncapped-pending-treasury-rows.ts
 *   npx tsx scripts/debug/cancel-uncapped-pending-treasury-rows.ts --apply
 */
import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";
import { countDistinctOfficers, getEffectivePlayerPayoutCap } from "@/lib/treasury/payoutCapValues";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

interface PendingRow {
  _id: ObjectId;
  partyId: ObjectId;
  countryId: string;
  type: "send" | "transfer" | "request";
  amount: number;
  targetCharacterId?: ObjectId;
  proposedBy: ObjectId;
  proposedAtTurn: number;
  expiresAtTurn: number;
  approvalModeAtPropose?: "single" | "double";
  treasurerApproval?: { characterId: ObjectId; approvedAt: Date };
  leadershipApproval?: { characterId: ObjectId; approvedAt: Date };
  status: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  try {
    const db = client.db();

    const gameState = await db
      .collection<{ currentTurn?: number }>("gameState")
      .findOne({}, { projection: { currentTurn: 1 } });
    const currentTurn = gameState?.currentTurn;
    if (typeof currentTurn !== "number") {
      throw new Error("Could not read gameState.currentTurn");
    }

    const open = await db
      .collection<PendingRow>("pendingTreasuryTransactions")
      .find({ status: "open", type: { $in: ["send", "request"] } })
      .toArray();

    // The ceiling is NOT the flat country value: a body with two or more
    // distinct officers seated is allowed a multiple of it. Filtering on
    // the base figure would mark a perfectly payable row unpayable and
    // cancel it, which on this collection means destroying a live
    // request somebody is waiting on.
    //
    // `pendingTreasuryTransactions` only ever holds NATIONAL party rows
    // (state-party and caucus sends execute immediately and never queue),
    // so the party's own three seats are the ones that count.
    const partyDocs = await db
      .collection<{
        _id: ObjectId;
        name?: string;
        sequentialId?: number;
        chairId?: ObjectId | null;
        viceChairId?: ObjectId | null;
        treasurerId?: ObjectId | null;
      }>("politicalParties")
      .find({
        _id: {
          $in: [...new Set(open.map((r) => String(r.partyId)))].map((id) => new ObjectId(id)),
        },
      })
      .toArray();
    const partyById = new Map(partyDocs.map((p) => [String(p._id), p]));

    const capForRow = (row: PendingRow): number => {
      const party = partyById.get(String(row.partyId));
      return getEffectivePlayerPayoutCap(
        row.countryId,
        countDistinctOfficers([
          party?.chairId?.toString(),
          party?.viceChairId?.toString(),
          party?.treasurerId?.toString(),
        ])
      );
    };

    const unpayable = open.filter((row) => row.amount > capForRow(row));

    console.log(`Current turn: ${currentTurn}`);
    console.log(`Open send/request rows: ${open.length}`);
    console.log(`Above their country's payout cap: ${unpayable.length}\n`);

    if (unpayable.length === 0) {
      console.log("Nothing to cancel.");
      return;
    }

    // Names make the dry run reviewable against the panel rather than a wall
    // of ObjectIds; a missing character is not an error, just an unnamed row.
    const referencedCharacterIds = unpayable
      .flatMap((r) => [
        r.proposedBy,
        r.targetCharacterId,
        // The approvers too, or a row that already carries a signature
        // prints it as "undefined" and the dry run cannot be checked
        // against what the panel shows.
        r.treasurerApproval?.characterId,
        r.leadershipApproval?.characterId,
      ])
      .filter((id): id is ObjectId => id != null);
    const characters = await db
      .collection<{ _id: ObjectId; name?: string }>("characters")
      .find({ _id: { $in: referencedCharacterIds } })
      .project<{ _id: ObjectId; name?: string }>({ name: 1 })
      .toArray();
    const nameById = new Map(characters.map((c) => [String(c._id), c.name ?? "(unnamed)"]));

    for (const row of unpayable) {
      const party = partyById.get(String(row.partyId));
      const approvals = [
        row.treasurerApproval
          ? `slot1=${nameById.get(String(row.treasurerApproval.characterId))}`
          : "slot1=empty",
        row.leadershipApproval
          ? `slot2=${nameById.get(String(row.leadershipApproval.characterId))}`
          : "slot2=empty",
      ].join(" ");
      console.log(
        [
          `  ${row._id.toString()}`,
          `${row.countryId} ${party?.name ?? "(unknown party)"} #${party?.sequentialId ?? "?"}`,
          `${row.type}${row.approvalModeAtPropose ? `/${row.approvalModeAtPropose}` : ""}`,
          `${fmt(row.amount)} vs cap ${fmt(capForRow(row))}`,
          `by ${nameById.get(String(row.proposedBy)) ?? "(unknown)"}`,
          `turn ${row.proposedAtTurn} expires ${row.expiresAtTurn}`,
          approvals,
        ].join(" | ")
      );
    }

    if (!APPLY) {
      console.log(`\nDRY RUN. Re-run with --apply to cancel these ${unpayable.length} rows.`);
      return;
    }

    const result = await db.collection<PendingRow>("pendingTreasuryTransactions").updateMany(
      { _id: { $in: unpayable.map((r) => r._id) }, status: "open" },
      {
        $set: {
          status: "cancelled",
          resolvedAt: new Date(),
          resolvedAtTurn: currentTurn,
        },
      }
    );
    console.log(`\nCancelled ${result.modifiedCount} of ${unpayable.length} rows.`);

    const residual = await db
      .collection<PendingRow>("pendingTreasuryTransactions")
      .countDocuments({ status: "open", type: { $in: ["send", "request"] } });
    console.log(`Open send/request rows remaining: ${residual}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
