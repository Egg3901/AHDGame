/**
 * The supervisory pass: assess every active charter against the capital
 * requirement, mark the breaches, and revoke the charters that ran out of time.
 *
 * Runs alongside the solvency pass rather than inside it, because the two
 * answer different questions. Solvency asks "can this bank meet withdrawals
 * today"; supervision asks "is this bank carrying enough capital for what it
 * has lent". A bank can pass one and fail the other, and conflating them would
 * mean either failing solvent-but-thin banks outright or never catching them.
 */

import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit/recordAudit";
import { createSystemNewsPost } from "@/lib/news";
import { emitTx } from "@/lib/financialTxLog/emit";
import { revokeCharter } from "./charter";
import {
  RECAP_GRACE_TURNS,
  assessCapital,
  capitalShortfall,
  recapDeadlineExpired,
  type CapitalStanding,
} from "./capitalAdequacy";

export interface SupervisionSummary {
  banksAssessed: number;
  stressed: number;
  undercapitalized: number;
  chartersRevoked: number;
  errors: string[];
}

const ZERO: SupervisionSummary = {
  banksAssessed: 0,
  stressed: 0,
  undercapitalized: 0,
  chartersRevoked: 0,
  errors: [],
};

export async function processBankSupervision(db: Db, turn: number): Promise<SupervisionSummary> {
  const summary: SupervisionSummary = { ...ZERO, errors: [] };

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ "bankCharter.status": "active" })
    .project<Pick<Corporation, "_id" | "name" | "userId" | "liquidCapital" | "bankCharter">>({
      name: 1,
      userId: 1,
      liquidCapital: 1,
      bankCharter: 1,
    })
    .toArray();

  for (const corp of corps) {
    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") continue;
    if (charter.lastSupervisionTurn === turn) continue;

    try {
      const position = assessCapital({
        postedCapital: charter.postedCapital ?? 0,
        liquidCapital: corp.liquidCapital ?? 0,
        totalLoans: charter.totalLoans ?? 0,
        propBookMarkValue: charter.propBookMarkValue ?? 0,
      });
      summary.banksAssessed += 1;

      const previous: CapitalStanding = charter.capitalStanding ?? "adequate";
      const standing = position.standing;
      if (standing === "stressed") summary.stressed += 1;
      if (standing === "undercapitalized") summary.undercapitalized += 1;

      // The clock starts when the breach starts and is cleared the moment the
      // bank is back above the minimum, so a bank that cures and later breaches
      // again gets a fresh grace period rather than inheriting a stale one.
      const since =
        standing === "undercapitalized" ? (charter.undercapitalizedSinceTurn ?? turn) : undefined;

      const expired = standing === "undercapitalized" && recapDeadlineExpired(since, turn);

      if (expired) {
        const revoked = await revokeForUndercapitalization(db, corp, turn);
        if (revoked) summary.chartersRevoked += 1;
        continue;
      }

      await db.collection<Corporation>("corporations").updateOne(
        { _id: corp._id, "bankCharter.status": "active" },
        {
          $set: {
            "bankCharter.capitalStanding": standing,
            "bankCharter.capitalRatio": Math.round(position.capitalRatio * 10_000) / 10_000,
            "bankCharter.stressedCapitalRatio":
              Math.round(position.stressedCapitalRatio * 10_000) / 10_000,
            "bankCharter.lastSupervisionTurn": turn,
            ...(since !== undefined ? { "bankCharter.undercapitalizedSinceTurn": since } : {}),
            updatedAt: new Date(),
          },
          ...(since === undefined
            ? { $unset: { "bankCharter.undercapitalizedSinceTurn": "" } }
            : {}),
        }
      );

      // Notify only on a CHANGE of standing. A bank that has been stressed for
      // thirty turns does not need thirty notifications, and the one that just
      // slipped needs to not miss it among them.
      if (standing !== previous && corp.userId) {
        void createNotification({
          userId: corp.userId,
          type: standing === "adequate" ? "bank_supervision_cleared" : "bank_supervision_breach",
          title:
            standing === "undercapitalized"
              ? "Bank undercapitalized"
              : standing === "stressed"
                ? "Bank failed its stress test"
                : "Bank capital restored",
          message: supervisionMessage(corp.name, standing, position, turn),
          metadata: { corporationId: corp._id.toHexString() },
        });
      }
    } catch (err) {
      summary.errors.push(`${corp.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}

function supervisionMessage(
  bankName: string,
  standing: CapitalStanding,
  position: ReturnType<typeof assessCapital>,
  turn: number
): string {
  if (standing === "undercapitalized") {
    const shortfall = capitalShortfall(position);
    return `${bankName} is below the minimum capital requirement. Post ${shortfall.toLocaleString()} more capital by turn ${turn + RECAP_GRACE_TURNS} or the charter is revoked.`;
  }
  if (standing === "stressed") {
    return `${bankName} meets the minimum capital requirement but does not survive the supervisory scenario. It cannot distribute to its owner or take new proprietary positions until it does.`;
  }
  return `${bankName} is back above the capital requirement. Distributions are available again.`;
}

async function revokeForUndercapitalization(
  db: Db,
  corp: Pick<Corporation, "_id" | "name" | "userId" | "bankCharter">,
  turn: number
): Promise<boolean> {
  const now = new Date();
  // Revoked, not "failed". The bank did not run out of money to pay depositors
  // — the supervisor pulled the licence of a bank that would not recapitalize.
  // Flatten the prop book into treasury first so investment-bank assets are
  // not trapped on a dead charter, then the existing revoke path refunds
  // posted capital (when deposits are already zero) and archives. The failure
  // path haircuts depositors; using it here would punish them for their bank's
  // owner ignoring a deadline.
  const unwoundBook = await unwindPropBookToTreasury(db, corp, turn);
  const revoked = await revokeCharter(db, corp._id, "undercapitalized");
  if (!revoked.ok) return false;

  if (corp.userId) {
    void createNotification({
      userId: corp.userId,
      type: "bank_supervision_breach",
      title: "Bank charter revoked",
      message: `${corp.name}'s banking charter has been revoked: it stayed below the minimum capital requirement past the recapitalization deadline.`,
      metadata: { corporationId: corp._id.toHexString() },
    });
  }

  createSystemNewsPost(
    `Regulators revoked ${corp.name}'s banking charter after it failed to meet the minimum capital requirement.`,
    "legislation"
  ).catch(() => {});

  recordAudit({
    source: "turn",
    action: "bank.charter.revoke_undercapitalized",
    category: "money",
    turn,
    ts: now,
    subject: { type: "corporation", id: corp._id, name: corp.name },
    refs: { corporationId: corp._id },
    outcome: "ok",
    meta: {
      reason: "undercapitalized",
      graceTurns: RECAP_GRACE_TURNS,
      refundedCapital: revoked.refundedCapital,
      unwoundPropBook: unwoundBook,
    },
  });
  return true;
}

/**
 * Convert a proprietary book into treasury cash at the last marked value.
 * bankSolvencyTurn has already marked against this turn's prices, so the
 * cached mark is the orderly close-out price — we do not re-hit the market.
 */
async function unwindPropBookToTreasury(
  db: Db,
  corp: Pick<Corporation, "_id" | "name" | "bankCharter">,
  turn: number
): Promise<number> {
  const charter = corp.bankCharter;
  if (!charter || charter.status !== "active") return 0;
  const mark = Math.max(0, charter.propBookMarkValue ?? 0);
  const hasPositions = (charter.propBook?.length ?? 0) > 0;
  if (mark <= 0 && !hasPositions) return 0;

  const result = await db.collection<Corporation>("corporations").updateOne(
    { _id: corp._id, "bankCharter.status": "active" },
    {
      ...(mark > 0 ? { $inc: { liquidCapital: mark } } : {}),
      $set: {
        "bankCharter.propBook": [],
        "bankCharter.propBookMarkValue": 0,
        updatedAt: new Date(),
      },
    }
  );
  if (result.modifiedCount === 0) return 0;
  if (mark <= 0) return 0;

  await emitTx(db, {
    type: "bank_prop_trade_sell",
    turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: corp._id,
    subjectName: corp.name,
    amount: mark,
    currencyCode: (charter.currency ?? "USD") as CurrencyCode,
    counterpartyType: "system",
    counterpartyName: "Prop book",
    meta: { reason: "supervision_revoke_unwind" },
  });
  return mark;
}
