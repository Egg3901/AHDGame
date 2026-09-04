import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type {
  Defect,
  DetectResult,
  HealPlan,
  HealResult,
  HealContext,
  VerifyResult,
} from "../types";

/**
 * Ticket #1267. At turn 605 Hunt Oil Company absorbed Vermont Finance through
 * the hostile-takeover merge while the merger still deleted the absorbed
 * shell unconditionally. The bank charter is a sub-document on the
 * corporation, so Vermont Finance's live retail USD bank died with it:
 * no transfer, no waterfall, no error. (The code half — transfer-or-refuse on
 * both merge paths — is PR #1389.)
 *
 * WHAT WAS LOST (Vermont Finance bank, pre-merge, from the ticket screenshots
 * corroborated by the turn-605 money-supply aggregate)
 *
 *   cashReserves (ring-fenced vault cash)  $123.41M  — destroyed with the doc
 *   npcDeposits (household book)             $71.11M  — stranded: the matching
 *     $71.11M left the central bank's household pool when households deposited
 *     (bankingTurn moves npcDeposits against externalBroadMoney) and was never
 *     returned, so externalBroadMoney_USD is understated by the book
 *   playerDeposits / loans out / CB facilities / interbank  $0 — verified zero
 *     orphaned bankLoans, interbankLoans, savingsAccounts and savingsHolder
 *     pointers, so there is no trapped saver or borrower to re-key
 *   financial sectors — moved to Hunt Oil correctly by the merge itself
 *
 * WHAT IS RESTITUTED
 *
 * The revoke waterfall the player would have run had the fixed code refused
 * the merge (Hunt Oil already operated a live USD bank, so refusal was the
 * correct outcome): the household book returns to the money supply out of the
 * estate's own cash, and the residual above the book goes to the owner,
 * capped at book equity — min(123.41 − 71.11, 52.29) = $52.29M to Hunt Oil's
 * liquidCapital. The $0.01M rounding dust stays destroyed.
 *
 * PRECISION. The charter doc is gone, so the figures are the ticket
 * screenshots at displayed $M precision: 71,110,000 and 52,290,000, each
 * ±$5,000. Deliberately EXCLUDED: the ~1 turn of bank income the estate would
 * have earned since (immaterial and speculative) and the dust above.
 *
 * IDEMPOTENCY
 *
 * Each recipient document gets a durable `remediation["AHD-1267-..."]`
 * marker, written in the SAME atomic `updateOne` as the increment, under a
 * filter that requires the marker to be absent. A second run matches nothing,
 * and the detector counts recipients missing the marker, so it returns zero
 * once applied.
 *
 * This heal MINTS MONEY on purpose: it restores value the merge bug
 * destroyed, so `moneyDelta` is non-zero and the `money-conserving` guard is
 * absent. Both legs emit a `restitution_credit` tx row referencing the
 * destroyed charter, so the shadow ledger books an attributed `restitution`
 * mint rather than showing unexplained jumps. USD is the anchor currency
 * (rate 1), so local and anchor amounts coincide.
 */

/** Marker key under `remediation` on each recipient document. */
export const DEFECT_ID = "AHD-1267-vf-bank-restitution";

/** Turn Hunt Oil absorbed Vermont Finance (merge legs are stamped here). */
export const MERGE_TURN = 605;

/** Absorbed shell. Gone; kept for receipts and notes. */
export const VERMONT_FINANCE_ID = "6a7c92fdef6c80918cf51b26";

/** Acquirer. Receives the owner residual. */
export const HUNT_OIL_ID = "6a78f819ee56df6f23dc55bd";

/** Central-bank doc holding the USD household pool. String _id. */
export const US_CB_ID = "US";

/** Owner residual: min(vault cash − household book, book equity), $M precision. */
export const HUNT_RESIDUAL_USD = 52_290_000;

/** Household book stranded out of the money supply, $M precision. */
export const NPC_RETURN_USD = 71_110_000;

export const RESTITUTION_CURRENCY: CurrencyCode = "USD";

const MARKER_PATH = `remediation.${DEFECT_ID}`;

interface CorporationDoc {
  _id: ObjectId;
  name?: string;
  liquidCurrencyCode?: CurrencyCode | string | null;
  remediation?: Record<string, unknown>;
}

interface CentralBankDoc {
  _id: string;
  externalBroadMoney?: number;
  remediation?: Record<string, unknown>;
}

/** One planned write: which document, which field, how much. */
interface PlannedRestitution {
  kind: "hunt-residual" | "npc-return";
  collection: "corporations" | "centralBanks";
  /** Stringified _id for touched lists and receipts. */
  docId: string;
  subjectName: string;
  amount: number;
  currencyCode: CurrencyCode;
  balanceField: string;
}

interface Payload {
  restitutions: PlannedRestitution[];
  totalUsd: number;
}

function hasMarker(doc: { remediation?: Record<string, unknown> } | undefined): boolean {
  return Boolean(doc?.remediation?.[DEFECT_ID]);
}

/** The two pinned rows, in heal order: household pool first, owner second. */
function pinnedRows(): PlannedRestitution[] {
  return [
    {
      kind: "npc-return",
      collection: "centralBanks",
      docId: US_CB_ID,
      subjectName: "USD external broad money",
      amount: NPC_RETURN_USD,
      currencyCode: RESTITUTION_CURRENCY,
      balanceField: "externalBroadMoney",
    },
    {
      kind: "hunt-residual",
      collection: "corporations",
      docId: HUNT_OIL_ID,
      subjectName: "Hunt Oil Company",
      amount: HUNT_RESIDUAL_USD,
      currencyCode: RESTITUTION_CURRENCY,
      balanceField: "liquidCapital",
    },
  ];
}

async function loadDocs(db: Db): Promise<{
  hunt: CorporationDoc | undefined;
  usCb: CentralBankDoc | undefined;
}> {
  const [huntDocs, cbDocs] = await Promise.all([
    db
      .collection<CorporationDoc>("corporations")
      .find({ _id: new ObjectId(HUNT_OIL_ID) })
      .toArray(),
    db.collection<CentralBankDoc>("centralBanks").find({ _id: US_CB_ID }).toArray(),
  ]);
  return { hunt: huntDocs[0], usCb: cbDocs[0] };
}

/**
 * Rows still owed restitution: pinned rows whose recipient exists and lacks
 * the marker. A recipient that is gone has nothing to credit, so it reads as
 * clean — same convention as AHD-1266.
 */
async function buildPlanned(db: Db): Promise<{ planned: PlannedRestitution[]; notes: string[] }> {
  const { hunt, usCb } = await loadDocs(db);
  const notes: string[] = [];
  const planned: PlannedRestitution[] = [];
  for (const row of pinnedRows()) {
    const doc = row.collection === "corporations" ? hunt : usCb;
    if (!doc) {
      notes.push(`${row.subjectName} is gone; nothing to credit`);
      continue;
    }
    if (hasMarker(doc)) continue;
    planned.push(row);
  }
  return { planned, notes };
}

async function detect(db: Db): Promise<DetectResult> {
  const { planned, notes } = await buildPlanned(db);
  return {
    affected: planned.length,
    sample: planned.map((row) => ({
      kind: row.kind,
      collection: row.collection,
      docId: row.docId,
      subjectName: row.subjectName,
      amount: row.amount,
      currencyCode: row.currencyCode,
      balanceField: row.balanceField,
    })),
    notes: [
      "pinned rows of the turn-605 Vermont Finance bank destruction (ticket #1267)",
      planned.length === 0
        ? "every recipient already carries the AHD-1267 marker, or is gone"
        : `${planned.length} restitution legs still owed`,
      ...notes,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const { planned, notes } = await buildPlanned(db);
  const totalUsd = planned.reduce((sum, row) => sum + row.amount, 0);

  if (planned.length === 0) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary: "AHD-1267: nothing to restitute (every recipient already credited, or gone)",
      notes,
    };
  }

  return {
    affected: planned.length,
    touched: planned.map((row) => ({ collection: row.collection, ids: [row.docId] })),
    moneyDelta: totalUsd,
    summary: `AHD-1267: restitute ${totalUsd.toLocaleString("en-US")} USD across ${planned.length} legs for the destroyed Vermont Finance bank (turn-${MERGE_TURN} merger)`,
    notes: [
      `household book ${NPC_RETURN_USD.toLocaleString("en-US")} USD back to externalBroadMoney; owner residual ${HUNT_RESIDUAL_USD.toLocaleString("en-US")} USD to Hunt Oil liquidCapital`,
      "figures are ticket-screenshot $M precision (±$5,000); the $0.01M rounding dust stays destroyed",
      "no trapped savers or borrowers: zero orphaned loans, accounts and pointers verified, so nothing is re-keyed",
      "MINTS MONEY deliberately: it restores value the merge bug destroyed",
      "each leg emits a restitution_credit tx row referencing the destroyed charter, so the shadow ledger books an attributed mint",
      ...notes,
    ],
    payload: { restitutions: planned, totalUsd } satisfies Payload,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as Payload | undefined;
  const restitutions = payload?.restitutions ?? [];
  if (restitutions.length === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to restitute"] };
  }

  const applied: PlannedRestitution[] = [];
  for (const row of restitutions) {
    // The marker is written in the SAME update as the increment, under a
    // filter that demands its absence. Two concurrent runs cannot both
    // credit: the second matches nothing.
    const update = {
      $inc: { [row.balanceField]: row.amount },
      $set: {
        [MARKER_PATH]: {
          ticket: 1267,
          creditedAt: ctx.now,
          kind: row.kind,
          amount: row.amount,
          currencyCode: row.currencyCode,
          destroyedCharterOwner: VERMONT_FINANCE_ID,
          sourceTurn: MERGE_TURN,
          runId: ctx.runId ?? null,
        },
        updatedAt: ctx.now,
      },
    };
    const res =
      row.collection === "corporations"
        ? await db
            .collection<CorporationDoc>("corporations")
            .updateOne({ _id: new ObjectId(row.docId), [MARKER_PATH]: { $exists: false } }, update)
        : await db
            .collection<CentralBankDoc>("centralBanks")
            .updateOne({ _id: row.docId, [MARKER_PATH]: { $exists: false } }, update);
    if (res.modifiedCount === 1) applied.push(row);
  }

  if (applied.length > 0) {
    const thresholds = await loadTxThresholds(db);
    const entries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = applied.map(
      (row) =>
        row.collection === "corporations"
          ? {
              type: "restitution_credit" as const,
              turn: MERGE_TURN,
              createdAt: ctx.now,
              subjectType: "corporation" as const,
              subjectId: new ObjectId(row.docId),
              subjectName: row.subjectName,
              amount: row.amount,
              currencyCode: row.currencyCode,
              anchorAmount: row.amount,
              meta: {
                ticket: 1267,
                defectId: DEFECT_ID,
                runId: ctx.runId ?? null,
                kind: "owner_residual",
                destroyedCharterOwner: VERMONT_FINANCE_ID,
                sourceTurn: MERGE_TURN,
              },
            }
          : {
              type: "restitution_credit" as const,
              turn: MERGE_TURN,
              createdAt: ctx.now,
              subjectType: "government" as const,
              countryId: "US",
              subjectName: row.subjectName,
              amount: row.amount,
              currencyCode: row.currencyCode,
              anchorAmount: row.amount,
              meta: {
                ticket: 1267,
                defectId: DEFECT_ID,
                runId: ctx.runId ?? null,
                kind: "npc_book_return",
                destroyedCharterOwner: VERMONT_FINANCE_ID,
                sourceTurn: MERGE_TURN,
              },
            }
    );
    await emitTxBulk(db, entries, thresholds);
  }

  // emitTxBulk mints its own ids, so read them back rather than guessing: a
  // rollback has to be able to delete the receipts it created.
  const insertedTxIds = ctx.runId
    ? await db
        .collection<FinancialTxLogEntry>("financialTxLog")
        .find({ type: "restitution_credit", "meta.runId": ctx.runId }, { projection: { _id: 1 } })
        .toArray()
    : [];

  return {
    documentsScanned: restitutions.length,
    documentsUpdated: applied.length,
    insertedIds:
      insertedTxIds.length > 0
        ? [{ collection: "financialTxLog", ids: insertedTxIds.map((doc) => doc._id.toString()) }]
        : undefined,
    notes: [
      `restituted ${applied.length} of ${restitutions.length} legs`,
      `emitted ${insertedTxIds.length} restitution_credit receipts`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const after = await detect(db);
  const { hunt, usCb } = await loadDocs(db);
  const marked = [hunt, usCb].filter((doc) => hasMarker(doc)).length;

  return {
    ok: after.affected === 0,
    remaining: after.affected,
    notes: [
      `${marked} of 2 recipients carry the AHD-1267 marker`,
      after.affected === 0
        ? "detector is clean: a re-run credits nobody"
        : `${after.affected} legs still uncredited`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title:
    "Pre-fix merger deleted Vermont Finance's bank: restitute the owner residual and the stranded household book",
  severity: "P1",
  codeFix: {
    pr: 1389,
    mergedTo: "main",
    // d0e0b3b1be is the squash-merge of the transfer-or-refuse merger fix
    // onto development, carried to main via the staging waypoint. The code
    // gate requires it as an ancestor of whatever is deployed to prod.
    requiredCommit: "d0e0b3b1be41416cc682f11464ea4b9292bc5fd4",
  },
  seedFix: {
    status: "not-needed",
    note: "banks are chartered at runtime by player corporations owning a financial sector (banking/charter issueCharter); seeds create no charters — only the bankCharterHistory runtime collection entry in the seed manifest and the corporations_bankCharter_status index.",
  },
  envs: ["prod"],
  idempotent: true,
  // Deliberate: this restores value the merge bug destroyed on top of the
  // shell cash the merger already moved, so the money-conserving guard is
  // omitted rather than worked around.
  mintsMoney: true,
  guards: ["turn-lock-free", "max-affected:2"],
  detect,
  plan,
  apply,
  verify,
};
