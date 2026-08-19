import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import type { ExchangeRate } from "@/lib/db/types";
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
 * Ticket #1124. Brazil's bondholders were force-converted out of BRL at a rate
 * the engine itself had corrupted.
 *
 * Brazil's 1953 monetary baseline carried an inflation TARGET of 10%, taken
 * from the Vargas-era CPI, so the Taylor rule was aiming FOR high inflation
 * rather than defending a stable currency. BRL left a 17.2 to 17.8 plateau
 * around turns 130 to 172 and ran to a peak of 26.19 by turn 215. The code half
 * (commit 503e6e1e31) stops treating the Vargas CPI as a target, and the rate
 * is already walking back toward equilibrium on its own.
 *
 * WHAT IS RESTITUTABLE, AND WHAT IS NOT
 *
 * Almost nothing here is. An unrealized loss on a bond still held repairs
 * itself as BRL falls back toward target, and a player who chose to sell into
 * the bad rate made a choice. Neither is restituted.
 *
 * Bond MATURITY is the exception, and it is the ONLY exception. A holder cannot
 * elect to keep holding a bond that has matured: the engine converts the face
 * value out of BRL into anchor on the spot, at whatever rate the corrupted
 * currency happened to be showing that turn. That is a forced sale at a price
 * the bug set, so it is made good.
 *
 * THE COUNTERFACTUAL RATE
 *
 * {@link COUNTERFACTUAL_BRL_RATE} is `exchangeRates.BR.macroTarget`, the
 * engine's own corrected equilibrium for BRL. It is deliberately not a
 * hand-picked number and not a historical average: it is what the fixed code
 * says the rate should be.
 *
 * WHY THE ROWS ARE HARDCODED
 *
 * `financialTxLog` rows carry a 7-day `expiresAt` TTL, so the affected set ages
 * out of the database. The 22 rows were snapshotted while they still existed
 * and are pinned in {@link FORCED_BRL_MATURITIES} below, which keeps this heal
 * re-derivable, reviewable and testable long after the source rows are gone.
 * The selector that produced them was:
 *
 *   { type: "bond_maturity", turn: { $in: [180, 192, 204, 216] },
 *     $or: [{ currencyCode: "BRL" }, { "meta.bondCurrency": "BRL" }] }
 *
 * `brlAmount` is `meta.bondAmount` where the row carried one, else `amount`.
 *
 * IDEMPOTENCY
 *
 * Not via the source rows (they expire) and not via the emitted credit rows
 * (those expire too). Each RECIPIENT document gets a durable
 * `remediation["AHD-1124-brl-forced-maturity-restitution"]` marker, written in
 * the SAME atomic `updateOne` as the balance increment, under a filter that
 * requires the marker to be absent. A second run matches nothing, and the
 * detector counts recipients missing the marker, so it returns zero once
 * applied.
 *
 * This heal MINTS MONEY on purpose: it is paying back value the bug destroyed,
 * so `moneyDelta` is non-zero and the `money-conserving` guard is absent. Every
 * credit emits a `restitution_credit` tx row referencing its source maturity,
 * so the shadow ledger books an attributed `restitution` mint rather than
 * showing an unexplained jump in someone's balance.
 */

/** Marker key under `remediation` on the recipient document. Presence makes a re-run a no-op. */
export const DEFECT_ID = "AHD-1124-brl-forced-maturity-restitution";

const MARKER_PATH = `remediation.${DEFECT_ID}`;

/**
 * `exchangeRates.BR.macroTarget`: the corrected equilibrium BRL per 1 anchor.
 * Owner-locked. Do not retune this without re-running the whole repair.
 */
export const COUNTERFACTUAL_BRL_RATE = 18.369197584045413;

/** One forced maturity, snapshotted from prod before the TTL removed it. */
export interface ForcedMaturityRow {
  /** `_id` of the source `financialTxLog` bond_maturity row. */
  txId: string;
  turn: number;
  subjectType: "character" | "corporation";
  subjectId: string;
  subjectName: string;
  /** Face value returned, in BRL. */
  brlAmount: number;
  /** Anchor the holder actually received, at the corrupted rate. */
  anchorAmount: number;
}

/** The 22 forced maturities, 18 distinct holders. Snapshotted 2026-08-19. */
export const FORCED_BRL_MATURITIES: readonly ForcedMaturityRow[] = [
  {
    txId: "6a848fa68977c214beb23014",
    turn: 216,
    subjectType: "corporation",
    subjectId: "6a78ecfeee56df6f23dc52a9",
    subjectName: "Greenbaum Industries",
    brlAmount: 199999000,
    anchorAmount: 7636789.049201783,
  },
  {
    txId: "6a848fa68977c214beb23013",
    turn: 216,
    subjectType: "corporation",
    subjectId: "6a7fb24fc73b35b622347cdf",
    subjectName: "Lockheed Chemicals",
    brlAmount: 1600000000,
    anchorAmount: 61094617.86211565,
  },
  {
    txId: "6a83e6e797baa9dbe6bbbab5",
    turn: 204,
    subjectType: "corporation",
    subjectId: "6a78ecfeee56df6f23dc52a9",
    subjectName: "Greenbaum Industries",
    brlAmount: 111000000,
    anchorAmount: 4421909.945964794,
  },
  {
    txId: "6a83e6e797baa9dbe6bbbab4",
    turn: 204,
    subjectType: "corporation",
    subjectId: "6a7ccd0052c9a66f8edfa485",
    subjectName: "Butxot Holdings Incorporated",
    brlAmount: 1500000000,
    anchorAmount: 59755539.87871378,
  },
  {
    txId: "6a83e6e797baa9dbe6bbbab3",
    turn: 204,
    subjectType: "corporation",
    subjectId: "6a7c92fdef6c80918cf51b26",
    subjectName: "Hagemeyer Holding",
    brlAmount: 20000000,
    anchorAmount: 796740.5276500918,
  },
  {
    txId: "6a833e27f35db6c1c52230e6",
    turn: 192,
    subjectType: "character",
    subjectId: "6a77c349b1dd266d86317b07",
    subjectName: "Moshe Greenbaum",
    brlAmount: 4078000,
    anchorAmount: 176335.90245822963,
  },
  {
    txId: "6a833e27f35db6c1c52230e5",
    turn: 192,
    subjectType: "character",
    subjectId: "6a7b6f3fa99632ba02c8417e",
    subjectName: "Shuana Marie",
    brlAmount: 1010000,
    anchorAmount: 43673.18820078762,
  },
  {
    txId: "6a833e27f35db6c1c52230e4",
    turn: 192,
    subjectType: "character",
    subjectId: "6a7b083755411373c9cc483e",
    subjectName: "Andrew Rodrick",
    brlAmount: 46000,
    anchorAmount: 1989.0758982536936,
  },
  {
    txId: "6a833e27f35db6c1c52230e3",
    turn: 192,
    subjectType: "corporation",
    subjectId: "6a7ccd0052c9a66f8edfa485",
    subjectName: "Butxot Holdings Incorporated",
    brlAmount: 2000000000,
    anchorAmount: 86481560.79383363,
  },
  {
    txId: "6a833e27f35db6c1c52230e2",
    turn: 192,
    subjectType: "corporation",
    subjectId: "6a78ecfeee56df6f23dc52a9",
    subjectName: "Greenbaum Industries",
    brlAmount: 10000000,
    anchorAmount: 432407.80148508353,
  },
  {
    txId: "6a833e27f35db6c1c52230e1",
    turn: 192,
    subjectType: "character",
    subjectId: "6a77b5f318e42bc9dfb15a12",
    subjectName: "Selina Meyer",
    brlAmount: 1000000000,
    anchorAmount: 43240780.39681943,
  },
  {
    txId: "6a8295677056d560eb0664c9",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a7c595468d503872467c717",
    subjectName: "Lockheed Commerce",
    brlAmount: 183096000,
    anchorAmount: 9353227.555706833,
  },
  {
    txId: "6a8295677056d560eb0664c8",
    turn: 180,
    subjectType: "character",
    subjectId: "6a77c349b1dd266d86317b07",
    subjectName: "Moshe Greenbaum",
    brlAmount: 15000000,
    anchorAmount: 766256.0256200578,
  },
  {
    txId: "6a8295677056d560eb0664af",
    turn: 180,
    subjectType: "character",
    subjectId: "6a7c587268d503872467c603",
    subjectName: "Bjorn Buckley",
    brlAmount: 282982000,
    anchorAmount: 14455777.50946768,
  },
  {
    txId: "6a8295677056d560eb0664ae",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a78f819ee56df6f23dc55bd",
    subjectName: "Hunt Oil Company",
    brlAmount: 895000000,
    anchorAmount: 45719942.85924647,
  },
  {
    txId: "6a8295677056d560eb0664ad",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a78c979346400213cf9d2fb",
    subjectName: "Fiskars",
    brlAmount: 6000000,
    anchorAmount: 306502.4089428393,
  },
  {
    txId: "6a8295677056d560eb0664ac",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f50e464c15609c01fdf",
    subjectName: "Logi Shipping",
    brlAmount: 24503000,
    anchorAmount: 1251704.7597178852,
  },
  {
    txId: "6a8295677056d560eb0664ab",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f50e464c15609c01fe2",
    subjectName: "Logi Freight",
    brlAmount: 9888000,
    anchorAmount: 505115.9720887421,
  },
  {
    txId: "6a8295677056d560eb0664aa",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f4fe464c15609c01fc4",
    subjectName: "Metro Properties",
    brlAmount: 667000,
    anchorAmount: 34072.851272571905,
  },
  {
    txId: "6a8295677056d560eb0664a9",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f50e464c15609c01fd9",
    subjectName: "Prime Studios",
    brlAmount: 1151000,
    anchorAmount: 58797.379032579105,
  },
  {
    txId: "6a8295677056d560eb0664a8",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f4fe464c15609c01fbb",
    subjectName: "Green Agriculture",
    brlAmount: 78000,
    anchorAmount: 3984.531333224301,
  },
  {
    txId: "6a8295677056d560eb0664a7",
    turn: 180,
    subjectType: "corporation",
    subjectId: "6a779f4fe464c15609c01fbe",
    subjectName: "Green Group",
    brlAmount: 127000,
    anchorAmount: 6487.634350249823,
  },
] as const;

/**
 * Anchor owed on one forced maturity: what the holder should have received at
 * the corrected rate, minus what they were actually paid. Floors at zero
 * because this heal only ever credits, it never claws back.
 */
export function creditAnchorForRow(row: ForcedMaturityRow): number {
  const counterfactualAnchor = row.brlAmount / COUNTERFACTUAL_BRL_RATE;
  return Math.max(0, counterfactualAnchor - row.anchorAmount);
}

/** One holder's total, with the rows that make it up. */
export interface RecipientCredit {
  subjectType: "character" | "corporation";
  subjectId: string;
  subjectName: string;
  creditAnchor: number;
  rows: ForcedMaturityRow[];
}

/** Group the pinned rows by holder and sum the per-row credits. */
export function groupCredits(
  rows: readonly ForcedMaturityRow[] = FORCED_BRL_MATURITIES
): RecipientCredit[] {
  const byHolder = new Map<string, RecipientCredit>();
  for (const row of rows) {
    const key = `${row.subjectType}:${row.subjectId}`;
    const existing = byHolder.get(key);
    if (existing) {
      existing.creditAnchor += creditAnchorForRow(row);
      existing.rows.push(row);
      continue;
    }
    byHolder.set(key, {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      creditAnchor: creditAnchorForRow(row),
      rows: [row],
    });
  }
  return [...byHolder.values()].filter((credit) => credit.creditAnchor > 0);
}

/** Total anchor this heal will mint. */
export function totalCreditAnchor(
  rows: readonly ForcedMaturityRow[] = FORCED_BRL_MATURITIES
): number {
  return rows.reduce((sum, row) => sum + creditAnchorForRow(row), 0);
}

interface CharacterDoc {
  _id: ObjectId;
  name?: string;
  countryId?: string;
  currencyBalances?: { personal?: Partial<Record<CurrencyCode, number>> };
  remediation?: Record<string, unknown>;
}

interface CorporationDoc {
  _id: ObjectId;
  name?: string;
  countryId?: string;
  liquidCurrencyCode?: CurrencyCode | null;
  remediation?: Record<string, unknown>;
}

/** One planned write: which document, which field, how much, in which currency. */
interface PlannedCredit {
  subjectType: "character" | "corporation";
  subjectId: string;
  subjectName: string;
  creditAnchor: number;
  /** Settlement currency the holder actually banks in. */
  currencyCode: CurrencyCode;
  /** Local currency per 1 anchor at heal time. 1 for pre-forex holders, whose balances ARE anchor. */
  fxRate: number;
  /** Amount written to the balance field, in `currencyCode`. */
  creditLocal: number;
  /** Dotted path of the balance field to increment. */
  balanceField: string;
  /** Source rows, for the per-row tx receipts. */
  rows: ForcedMaturityRow[];
}

interface Payload {
  credits: PlannedCredit[];
  totalAnchor: number;
}

function toObjectIds(credits: RecipientCredit[], type: "character" | "corporation"): ObjectId[] {
  return credits
    .filter((credit) => credit.subjectType === type)
    .map((credit) => new ObjectId(credit.subjectId));
}

function hasMarker(doc: { remediation?: Record<string, unknown> } | undefined): boolean {
  return Boolean(doc?.remediation?.[DEFECT_ID]);
}

/** Load every recipient document the pinned rows point at, keyed `<type>:<id>`. */
async function loadRecipients(
  db: Db,
  credits: RecipientCredit[]
): Promise<Map<string, CharacterDoc | CorporationDoc>> {
  const characterIds = toObjectIds(credits, "character");
  const corporationIds = toObjectIds(credits, "corporation");
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

async function loadRatesByCurrency(db: Db): Promise<Map<string, number>> {
  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  return new Map(rates.map((rate) => [String(rate.currencyCode), rate.rate]));
}

/**
 * Resolve where one holder's credit lands: settlement currency, live rate, and
 * the balance field to increment. Returns null when the holder is gone, or has
 * already been credited.
 */
function planOne(
  credit: RecipientCredit,
  doc: CharacterDoc | CorporationDoc | undefined,
  ratesByCurrency: Map<string, number>
): PlannedCredit | null {
  if (!doc || hasMarker(doc)) return null;

  if (credit.subjectType === "character") {
    const character = doc as CharacterDoc;
    const currencyCode = getHomeCurrency({ countryId: character.countryId ?? "US" });
    // Pre-forex characters hold anchor directly in `cashOnHand`, so their rate
    // is 1 by construction and the local amount equals the anchor amount.
    const postForex = Boolean(character.currencyBalances?.personal);
    const fxRate = postForex ? (ratesByCurrency.get(currencyCode) ?? 0) : 1;
    if (!Number.isFinite(fxRate) || fxRate <= 0) return null;
    return {
      ...credit,
      currencyCode,
      fxRate,
      creditLocal: credit.creditAnchor * fxRate,
      balanceField: postForex ? `currencyBalances.personal.${currencyCode}` : "cashOnHand",
    };
  }

  const corporation = doc as CorporationDoc;
  // Pre-forex corps carry no `liquidCurrencyCode` and hold `liquidCapital` in
  // anchor, so rate 1 keeps the written amount and the receipt consistent.
  const liquidCurrency = corporation.liquidCurrencyCode ?? null;
  const currencyCode =
    liquidCurrency ?? getHomeCurrency({ countryId: corporation.countryId ?? "US" });
  const fxRate = liquidCurrency ? (ratesByCurrency.get(currencyCode) ?? 0) : 1;
  if (!Number.isFinite(fxRate) || fxRate <= 0) return null;
  return {
    ...credit,
    currencyCode,
    fxRate,
    creditLocal: credit.creditAnchor * fxRate,
    balanceField: "liquidCapital",
  };
}

async function buildPlannedCredits(db: Db): Promise<PlannedCredit[]> {
  const credits = groupCredits();
  const [recipients, ratesByCurrency] = await Promise.all([
    loadRecipients(db, credits),
    loadRatesByCurrency(db),
  ]);
  return credits
    .map((credit) =>
      planOne(credit, recipients.get(`${credit.subjectType}:${credit.subjectId}`), ratesByCurrency)
    )
    .filter((planned): planned is PlannedCredit => planned !== null);
}

async function detect(db: Db): Promise<DetectResult> {
  const planned = await buildPlannedCredits(db);
  return {
    affected: planned.length,
    sample: planned.slice(0, 10).map((credit) => ({
      subjectType: credit.subjectType,
      subjectId: credit.subjectId,
      subjectName: credit.subjectName,
      creditAnchor: credit.creditAnchor,
      currencyCode: credit.currencyCode,
      creditLocal: credit.creditLocal,
      sourceRows: credit.rows.length,
    })),
    notes: [
      `${FORCED_BRL_MATURITIES.length} pinned forced BRL maturities across ${groupCredits().length} holders`,
      planned.length === 0
        ? "every holder already carries the AHD-1124 marker, or is no longer present"
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
      summary: "AHD-1124: nothing to restitute (every holder already credited, or gone)",
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
    summary: `AHD-1124: credit ${Math.round(totalAnchor).toLocaleString("en-US")} anchor across ${credits.length} holders for ${FORCED_BRL_MATURITIES.length} bond maturities forced out of BRL at the corrupted rate`,
    notes: [
      `counterfactual rate ${COUNTERFACTUAL_BRL_RATE} (exchangeRates.BR.macroTarget)`,
      "per row: max(0, brlAmount / counterfactualRate - anchorAmount), converted to the holder's settlement currency at the current rate",
      "voluntary bond_sell losses and unrealized losses are deliberately excluded: only compulsory maturities",
      "MINTS MONEY deliberately: it repays value a currency bug destroyed",
      "each credit emits a restitution_credit tx row referencing its source maturity, so the shadow ledger books an attributed mint",
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
            ticket: 1124,
            creditedAt: ctx.now,
            creditAnchor: credit.creditAnchor,
            creditLocal: credit.creditLocal,
            currencyCode: credit.currencyCode,
            fxRate: credit.fxRate,
            counterfactualRate: COUNTERFACTUAL_BRL_RATE,
            sourceTxIds: credit.rows.map((row) => row.txId),
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
    const entries = applied.flatMap((credit) => {
      const holderAnchor = credit.creditAnchor;
      return credit.rows.map((row) => {
        const rowAnchor = creditAnchorForRow(row);
        // Split the holder's single balance write back across its source rows
        // so the receipts sum to exactly what was credited.
        const share = holderAnchor > 0 ? rowAnchor / holderAnchor : 0;
        return {
          type: "restitution_credit" as const,
          turn: row.turn,
          createdAt: ctx.now,
          subjectType: credit.subjectType,
          subjectId: new ObjectId(credit.subjectId),
          subjectName: credit.subjectName,
          amount: credit.creditLocal * share,
          currencyCode: credit.currencyCode,
          anchorAmount: rowAnchor,
          meta: {
            ticket: 1124,
            defectId: DEFECT_ID,
            runId: ctx.runId ?? null,
            sourceTxId: row.txId,
            sourceTurn: row.turn,
            sourceBrlAmount: row.brlAmount,
            sourceAnchorAmount: row.anchorAmount,
            counterfactualRate: COUNTERFACTUAL_BRL_RATE,
            fxRate: credit.fxRate,
          },
        };
      });
    });
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
  const credits = groupCredits();
  const recipients = await loadRecipients(db, credits);
  const marked = credits.filter((credit) =>
    hasMarker(recipients.get(`${credit.subjectType}:${credit.subjectId}`))
  ).length;

  return {
    ok: after.affected === 0,
    remaining: after.affected,
    notes: [
      `${marked} of ${credits.length} holders carry the AHD-1124 marker`,
      after.affected === 0
        ? "detector is clean: a re-run credits nobody"
        : `${after.affected} holders still uncredited`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Brazilian bond maturities were force-converted out of BRL at a corrupted rate",
  severity: "P1",
  codeFix: {
    pr: 374,
    mergedTo: "main",
    // 503e6e1e31 is the fix itself, authored on release/1.2.0. It reached main
    // squashed inside the 1.2.0 release commit, so THAT is the commit the code
    // gate can actually find in a deployed history.
    requiredCommit: "c116e8ecf7924785ca4a9077961f56de8901d4da",
  },
  seedFix: {
    status: "fixed",
    files: ["src/lib/constants/monetaryEra.ts"],
    note: "the bad value was authored data, not runtime state: the BR 1953 row carried targetInflation 10.0 (the Vargas CPI) and every seeded world read it. Commit 503e6e1e31 pinned BR to 4.0/8.0, so a fresh 1953 world no longer aims the Taylor rule at 10% inflation and cannot reproduce the currency run.",
    seedCheck: { countryId: "BR", era: "1953" },
  },
  envs: ["prod"],
  idempotent: true,
  // Deliberate: this repays value the currency bug destroyed on a forced sale,
  // so the money-conserving guard is omitted rather than worked around.
  mintsMoney: true,
  guards: ["turn-lock-free", "max-affected:25"],
  detect,
  plan,
  apply,
  verify,
};
