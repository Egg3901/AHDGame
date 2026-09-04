import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type {
  Defect,
  DetectResult,
  HealPlan,
  HealResult,
  HealContext,
  VerifyResult,
} from "../types";

/**
 * Ticket #1266. Turkey repudiated all 32 outstanding sovereign bond series at
 * turn 568, and the cascade's holder write-down debited holder CASH instead
 * of booking a paper loss (holders had already paid face value at purchase;
 * portfolio valuations already price holdings at market). Nine corporations
 * and ten characters were charged 95% of face a second time — e.g. Streibl
 * Defence Systems +38.2M → -281.1M GBP in a single turn.
 *
 * The code half removes the balance mutation from the cascade writer, so a
 * write-down is exposure accounting only. This heal repays the wrongfully
 * debited principal to the debited holders.
 *
 * WHAT IS RESTITUTED
 *
 * Exactly the second charge: units × 1,000 TRL face × 0.95 severity, per
 * holder, across the 32 bonds with `defaultedAtTurn: 568`. Characters are
 * credited back in TRL (the debit hit `currencyBalances.personal.TRL`
 * directly); corporations are credited in home currency via anchor at the
 * heal-time rate, mirroring the debit's conversion chain in reverse.
 *
 * Deliberately EXCLUDED: the ~80 NPP and 3 fund holders of the same bonds.
 * The writer never touched their balances (no debit branch for nppId/fundId),
 * so they were already paper-loss-only and have nothing to repay. The
 * earlier STDS cliffs (turns 411/435/457/524/530) have no defaulted bonds
 * behind them and are out of scope.
 *
 * WHY THE ROWS ARE PINNED
 *
 * Bond docs are live: a holder could trade defaulted paper after the snapshot
 * and move the units. The 19 rows below freeze the affected set as read from
 * prod on 2026-09-03 (selector: bonds with `defaultedAtTurn: 568`, holder
 * kinds corporationId/characterId), which keeps this heal reviewable and
 * testable regardless of later trading.
 *
 * IDEMPOTENCY
 *
 * Each recipient document gets a durable `remediation["AHD-1266-..."]`
 * marker, written in the SAME atomic `updateOne` as the balance increment,
 * under a filter that requires the marker to be absent. A second run matches
 * nothing, and the detector counts recipients missing the marker, so it
 * returns zero once applied.
 *
 * This heal MINTS MONEY on purpose: it repays value the bug destroyed, so
 * `moneyDelta` is non-zero and the `money-conserving` guard is absent. Every
 * credit emits a `restitution_credit` tx row referencing its source bonds, so
 * the shadow ledger books an attributed `restitution` mint rather than
 * showing an unexplained jump in someone's balance.
 */

/** Marker key under `remediation` on the recipient document. Presence makes a re-run a no-op. */
export const DEFECT_ID = "AHD-1266-tr-repudiation-restitution";

const MARKER_PATH = `remediation.${DEFECT_ID}`;

/** Turn Turkey repudiated: all 32 series share this `defaultedAtTurn`. */
export const REPUDIATION_TURN = 568;

/** Repudiate severity: market price 0.05 → 95% charged twice. */
export const REPUDIATION_SEVERITY = 0.95;

/** All 32 defaulted series are TRL-denominated. */
export const BOND_CURRENCY: CurrencyCode = "TRL";

/** One wrongfully debited holder, snapshotted from prod 2026-09-03. */
export interface RepudiationRefundRow {
  subjectType: "character" | "corporation";
  subjectId: string;
  subjectName: string;
  /** Total units held across the 32 series at snapshot time. */
  units: number;
  /** Source bond `_id`s, for receipts and audit. */
  bondIds: string[];
}

/** The 19 debited holders: 9 corporations, 10 characters. */
export const REPUDIATION_REFUNDS: readonly RepudiationRefundRow[] = [
  {
    subjectType: "corporation",
    subjectId: "6a789d7585aed43665ca529d",
    subjectName: "Streibl Defence Systems",
    units: 2438245,
    bondIds: [
      "6a8b1921731e2834fd8190e8",
      "6a8bc1ee5e756ebc2b5a876d",
      "6a8d135b862d72c8ed631c89",
      "6a91b0a916e01df0d60f4862",
      "6a93103223fac8a27c41f87e",
    ],
  },
  {
    subjectType: "corporation",
    subjectId: "6a823a2d75c412ca13389a40",
    subjectName: "Streibl Group",
    units: 1613500,
    bondIds: ["6a8b1921731e2834fd8190e8", "6a91b0a916e01df0d60f4862"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a8dbce43adf5da317fa5e39",
    subjectName: "The Electric Company",
    units: 945136,
    bondIds: ["6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a77ba2b18e42bc9dfb15fa2",
    subjectName: "Todoroki Systems",
    units: 839930,
    bondIds: ["6a8b1921731e2834fd8190e8"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a78ecfeee56df6f23dc52a9",
    subjectName: "Greenbaum Industries",
    units: 136706,
    bondIds: ["6a8bc1ee5e756ebc2b5a876d"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a779f49e464c15609c01e71",
    subjectName: "Value Outlets",
    units: 6612,
    bondIds: ["6a8bc1ee5e756ebc2b5a876d", "6a8c6ab005f5767506316a2d", "6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a779f49e464c15609c01e7d",
    subjectName: "Cyber Solutions",
    units: 3113,
    bondIds: ["6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a779f49e464c15609c01e62",
    subjectName: "National Industries",
    units: 1968,
    bondIds: ["6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "corporation",
    subjectId: "6a779f49e464c15609c01e74",
    subjectName: "National Stores",
    units: 1665,
    bondIds: ["6a8bc1ee5e756ebc2b5a876d", "6a8c6ab005f5767506316a2d", "6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "character",
    subjectId: "6a77d50e2fb91e2bdc779937",
    subjectName: "Rgold",
    units: 7307531,
    bondIds: [
      "6a8d135b862d72c8ed631c89",
      "6a8dbc1c56215387de765838",
      "6a8e650a72a64be7ece89f44",
      "6a950a8e5508988784223217",
      "6a95b35ab3439d6679d2d88d",
      "6a97ad75ad586649a688fb88",
    ],
  },
  {
    subjectType: "character",
    subjectId: "6a7c587268d503872467c603",
    subjectName: "Jeff Moreau",
    units: 2062645,
    bondIds: ["6a8c6ab005f5767506316a2d", "6a9704d9afacaebdecb9e734"],
  },
  {
    subjectType: "character",
    subjectId: "6a77c349b1dd266d86317b07",
    subjectName: "Moshe Greenbaum",
    units: 100000,
    bondIds: ["6a8c6ab005f5767506316a2d"],
  },
  {
    subjectType: "character",
    subjectId: "6a77b79c18e42bc9dfb15c99",
    subjectName: "Ren Todoroki",
    units: 95000,
    bondIds: ["6a8b1921731e2834fd8190e8"],
  },
  {
    subjectType: "character",
    subjectId: "6a78cdd0346400213cf9d4f6",
    subjectName: "Erich Lindner",
    units: 90656,
    bondIds: ["6a8e650a72a64be7ece89f44"],
  },
  {
    subjectType: "character",
    subjectId: "6a77b93818e42bc9dfb15e96",
    subjectName: "Callum MacLeod",
    units: 71371,
    bondIds: ["6a8b1921731e2834fd8190e8", "6a8e650a72a64be7ece89f44", "6a92678deb457222c6ed8b2b"],
  },
  {
    subjectType: "character",
    subjectId: "6a77a41ee464c15609c06324",
    subjectName: "Ariane Yeong",
    units: 17527,
    bondIds: ["6a8d135b862d72c8ed631c89"],
  },
  {
    subjectType: "character",
    subjectId: "6a77b61418e42bc9dfb15a42",
    subjectName: "Howard Hughes",
    units: 15559,
    bondIds: ["6a8bc1ee5e756ebc2b5a876d"],
  },
  {
    subjectType: "character",
    subjectId: "6a7a023a71e5d11a9601e36c",
    subjectName: "Iosif Bidenko",
    units: 1760,
    bondIds: ["6a8d135b862d72c8ed631c89", "6a950a8e5508988784223217", "6a97ad75ad586649a688fb88"],
  },
  {
    subjectType: "character",
    subjectId: "6a77bc2918e42bc9dfb1618e",
    subjectName: "Cletus Red",
    units: 1534,
    bondIds: ["6a8b1921731e2834fd8190e8"],
  },
] as const;

/**
 * TRL wrongfully taken from one holder: the exact second charge,
 * units × face × severity. Always positive; this heal credits only.
 */
export function refundTrlForRow(row: RepudiationRefundRow): number {
  return Math.max(0, row.units * 1_000 * REPUDIATION_SEVERITY);
}

/** Total TRL this heal repays across the pinned rows. */
export function totalRefundTrl(
  rows: readonly RepudiationRefundRow[] = REPUDIATION_REFUNDS
): number {
  return rows.reduce((sum, row) => sum + refundTrlForRow(row), 0);
}

interface CharacterDoc {
  _id: ObjectId;
  name?: string;
  remediation?: Record<string, unknown>;
}

interface CorporationDoc {
  _id: ObjectId;
  name?: string;
  countryId?: string | null;
  liquidCurrencyCode?: CurrencyCode | string | null;
  remediation?: Record<string, unknown>;
}

/** One planned write: which document, which field, how much, in which currency. */
interface PlannedCredit {
  subjectType: "character" | "corporation";
  subjectId: string;
  subjectName: string;
  /** TRL repaid (the wrongfully debited amount). */
  refundTrl: number;
  /** Same value in anchor at the heal-time TRL rate. */
  creditAnchor: number;
  /** Settlement currency the holder actually banks in. */
  currencyCode: CurrencyCode;
  /** Local currency per 1 anchor at heal time. */
  fxRate: number;
  /** Amount written to the balance field, in `currencyCode`. */
  creditLocal: number;
  /** Dotted path of the balance field to increment. */
  balanceField: string;
  /** Source row, for the tx receipt. */
  row: RepudiationRefundRow;
}

interface Payload {
  credits: PlannedCredit[];
  totalAnchor: number;
}

function toObjectIds(
  rows: readonly RepudiationRefundRow[],
  type: "character" | "corporation"
): ObjectId[] {
  return rows.filter((row) => row.subjectType === type).map((row) => new ObjectId(row.subjectId));
}

function hasMarker(doc: { remediation?: Record<string, unknown> } | undefined): boolean {
  return Boolean(doc?.remediation?.[DEFECT_ID]);
}

/** Load every recipient document the pinned rows point at, keyed `<type>:<id>`. */
async function loadRecipients(
  db: Db,
  rows: readonly RepudiationRefundRow[]
): Promise<Map<string, CharacterDoc | CorporationDoc>> {
  const characterIds = toObjectIds(rows, "character");
  const corporationIds = toObjectIds(rows, "corporation");
  const [characters, corporations] = await Promise.all([
    characterIds.length > 0
      ? db
          .collection<CharacterDoc>("characters")
          .find({ _id: { $in: characterIds } })
          .toArray()
      : Promise.resolve([]),
    corporationIds.length > 0
      ? db
          .collection<CorporationDoc>("corporations")
          .find({ _id: { $in: corporationIds } })
          .toArray()
      : Promise.resolve([]),
  ]);

  const byKey = new Map<string, CharacterDoc | CorporationDoc>();
  for (const doc of characters) byKey.set(`character:${doc._id.toString()}`, doc);
  for (const doc of corporations) byKey.set(`corporation:${doc._id.toString()}`, doc);
  return byKey;
}

/**
 * Resolve where one holder's refund lands. Characters are credited TRL
 * directly (the debit hit `currencyBalances.personal.TRL`); corporations
 * convert through anchor at the heal-time rate, mirroring the debit's
 * conversion chain in reverse. Returns null when the holder is gone, already
 * credited, or convertibility is unavailable.
 */
function planOne(
  row: RepudiationRefundRow,
  doc: CharacterDoc | CorporationDoc | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): PlannedCredit | null {
  if (!doc || hasMarker(doc)) return null;
  const refundTrl = refundTrlForRow(row);
  if (!(refundTrl > 0)) return null;
  const trlRate = fxByCurrency.get(BOND_CURRENCY) ?? 0;
  if (!Number.isFinite(trlRate) || trlRate <= 0) return null;
  const creditAnchor = refundTrl / trlRate;

  if (row.subjectType === "character") {
    return {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      refundTrl,
      creditAnchor,
      currencyCode: BOND_CURRENCY,
      fxRate: trlRate,
      creditLocal: refundTrl,
      balanceField: `currencyBalances.personal.${BOND_CURRENCY}`,
      row,
    };
  }

  const corporation = doc as CorporationDoc;
  // Pre-forex corps carry no liquid currency code and hold `liquidCapital`
  // in anchor, so rate 1 keeps the written amount and the receipt consistent.
  const homeCode = resolveCorpLiquidCurrencyCode({
    countryId: corporation.countryId,
    liquidCurrencyCode: corporation.liquidCurrencyCode,
  });
  const homeFx = homeCode ? (fxByCurrency.get(homeCode) ?? 0) : 1;
  if (!Number.isFinite(homeFx) || homeFx <= 0) return null;
  const creditLocal = anchorToCorpLiquidCapital(
    creditAnchor,
    { countryId: corporation.countryId, liquidCurrencyCode: corporation.liquidCurrencyCode },
    homeFx
  );
  return {
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    refundTrl,
    creditAnchor,
    currencyCode: homeCode ?? BOND_CURRENCY,
    fxRate: homeFx,
    creditLocal,
    balanceField: "liquidCapital",
    row,
  };
}

async function buildPlannedCredits(db: Db): Promise<PlannedCredit[]> {
  const [recipients, fxByCurrency] = await Promise.all([
    loadRecipients(db, REPUDIATION_REFUNDS),
    loadFxRatesByCurrency(db),
  ]);
  return REPUDIATION_REFUNDS.map((row) =>
    planOne(row, recipients.get(`${row.subjectType}:${row.subjectId}`), fxByCurrency)
  ).filter((planned): planned is PlannedCredit => planned !== null);
}

async function detect(db: Db): Promise<DetectResult> {
  const planned = await buildPlannedCredits(db);
  return {
    affected: planned.length,
    sample: planned.slice(0, 10).map((credit) => ({
      subjectType: credit.subjectType,
      subjectId: credit.subjectId,
      subjectName: credit.subjectName,
      refundTrl: credit.refundTrl,
      creditAnchor: credit.creditAnchor,
      currencyCode: credit.currencyCode,
      creditLocal: credit.creditLocal,
    })),
    notes: [
      `${REPUDIATION_REFUNDS.length} pinned holders of the turn-${REPUDIATION_TURN} TR repudiation`,
      planned.length === 0
        ? "every holder already carries the AHD-1266 marker, or is no longer present"
        : `${planned.length} holders still owe restitution`,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const credits = await buildPlannedCredits(db);
  const totalAnchor = credits.reduce((sum, credit) => sum + credit.creditAnchor, 0);

  if (credits.length === 0) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary: "AHD-1266: nothing to restitute (every holder already credited, or gone)",
    };
  }

  const characterIds = credits
    .filter((credit) => credit.subjectType === "character")
    .map((credit) => credit.subjectId);
  const corporationIds = credits
    .filter((credit) => credit.subjectType === "corporation")
    .map((credit) => credit.subjectId);

  const touched = [
    ...(characterIds.length > 0 ? [{ collection: "characters", ids: characterIds }] : []),
    ...(corporationIds.length > 0 ? [{ collection: "corporations", ids: corporationIds }] : []),
  ];

  return {
    affected: credits.length,
    touched,
    moneyDelta: totalAnchor,
    summary: `AHD-1266: credit ${Math.round(totalAnchor).toLocaleString("en-US")} anchor across ${credits.length} holders for the turn-${REPUDIATION_TURN} TR repudiation double-charge`,
    notes: [
      "per holder: units × 1,000 TRL × 0.95 severity, converted at heal-time rates (chars straight TRL, corps via anchor)",
      "NPP/fund holders excluded: the writer never debited them, so they have nothing to repay",
      "earlier STDS cliffs (turns 411/435/457/524/530) have no defaulted bonds behind them and are out of scope",
      "MINTS MONEY deliberately: it repays value the cascade bug destroyed",
      "each credit emits a restitution_credit tx row referencing its source bonds, so the shadow ledger books an attributed mint",
    ],
    payload: { credits, totalAnchor } satisfies Payload,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as Payload | undefined;
  const credits = payload?.credits ?? [];
  if (credits.length === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to restitute"] };
  }

  const applied: PlannedCredit[] = [];
  for (const credit of credits) {
    const collection = credit.subjectType === "character" ? "characters" : "corporations";
    // The marker is written in the SAME update as the increment, under a filter
    // that demands its absence. Two concurrent runs cannot both credit: the
    // second matches nothing.
    const res = await db.collection(collection).updateOne(
      { _id: new ObjectId(credit.subjectId), [MARKER_PATH]: { $exists: false } },
      {
        $inc: { [credit.balanceField]: credit.creditLocal },
        $set: {
          [MARKER_PATH]: {
            ticket: 1266,
            creditedAt: ctx.now,
            refundTrl: credit.refundTrl,
            creditAnchor: credit.creditAnchor,
            creditLocal: credit.creditLocal,
            currencyCode: credit.currencyCode,
            fxRate: credit.fxRate,
            sourceBondIds: credit.row.bondIds,
            runId: ctx.runId ?? null,
          },
          updatedAt: ctx.now,
        },
      }
    );
    if (res.modifiedCount === 1) applied.push(credit);
  }

  if (applied.length > 0) {
    const thresholds = await loadTxThresholds(db);
    const entries = applied.map((credit) => ({
      type: "restitution_credit" as const,
      turn: REPUDIATION_TURN,
      createdAt: ctx.now,
      subjectType: credit.subjectType,
      subjectId: new ObjectId(credit.subjectId),
      subjectName: credit.subjectName,
      amount: credit.creditLocal,
      currencyCode: credit.currencyCode,
      anchorAmount: credit.creditAnchor,
      meta: {
        ticket: 1266,
        defectId: DEFECT_ID,
        runId: ctx.runId ?? null,
        sourceBondIds: credit.row.bondIds,
        sourceTurn: REPUDIATION_TURN,
        refundTrl: credit.refundTrl,
        severity: REPUDIATION_SEVERITY,
        fxRate: credit.fxRate,
      },
    }));
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
    documentsScanned: credits.length,
    documentsUpdated: applied.length,
    insertedIds:
      insertedTxIds.length > 0
        ? [{ collection: "financialTxLog", ids: insertedTxIds.map((doc) => doc._id.toString()) }]
        : undefined,
    notes: [
      `credited ${applied.length} of ${credits.length} holders`,
      `emitted ${insertedTxIds.length} restitution_credit receipts`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const after = await detect(db);
  const recipients = await loadRecipients(db, REPUDIATION_REFUNDS);
  const marked = REPUDIATION_REFUNDS.filter((row) =>
    hasMarker(recipients.get(`${row.subjectType}:${row.subjectId}`))
  ).length;

  return {
    ok: after.affected === 0,
    remaining: after.affected,
    notes: [
      `${marked} of ${REPUDIATION_REFUNDS.length} holders carry the AHD-1266 marker`,
      after.affected === 0
        ? "detector is clean: a re-run credits nobody"
        : `${after.affected} holders still uncredited`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Turn-568 TR repudiation double-charged bondholders' cash on top of the paper loss",
  severity: "P1",
  codeFix: {
    pr: 1381,
    mergedTo: "main",
    // 9c8bca5440 is the squash-merge of the paper-loss cascade writer fix
    // onto development, carried to main via the staging waypoint. The code
    // gate requires it as an ancestor of whatever is deployed to prod.
    requiredCommit: "9c8bca5440305c9ef855d1133b3fad62c5bd1436",
  },
  seedFix: {
    status: "not-needed",
    note: "runtime cascade over live bond holdings: seeds create active bonds, never defaulted ones, and holder cash was only ever moved by the cascade writer itself.",
  },
  envs: ["prod"],
  idempotent: true,
  // Deliberate: this repays value the cascade bug destroyed on top of the
  // paper loss, so the money-conserving guard is omitted rather than worked
  // around.
  mintsMoney: true,
  guards: ["turn-lock-free", "max-affected:25"],
  detect,
  plan,
  apply,
  verify,
};
