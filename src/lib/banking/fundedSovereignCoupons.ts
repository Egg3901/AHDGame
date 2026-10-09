import { ObjectId, type Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget, FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import type { Corporation } from "@/lib/db/types/corporation";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { bondAccruesCoupon } from "@/lib/constants/bonds";
import {
  settleTransition,
  resumeSettlement,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import type { BankingTransition, TransitionLeg } from "@/lib/banking/rules/boundary";
import { checkBalancedTransfer } from "@/lib/banking/rules/invariants";
import {
  freezeSovereignCouponClaim,
  type SovereignCouponBondSnapshot,
  type SovereignCouponCorporationQuote,
} from "@/lib/banking/rules/sovereignCoupons";

/**
 * One document per frozen coupon claim. Claims used to live in an array on the
 * country's `federalBudget` document, which every unfunded turn grew by one
 * claim per sovereign bond. That made every whole-budget read heavier each turn
 * and put the document on course for the 16 MB limit. The claim, its id and its
 * frozen quotes are unchanged; only where it is kept moved.
 */
export const SOVEREIGN_COUPON_CLAIMS_COLLECTION = "sovereignCouponClaims";

export interface SovereignCouponClaimRecord {
  /** The claim id, `sovereign-coupon:<bondId>:<dueTurn>`. */
  _id: string;
  budgetId: string;
  /** Book position within the due turn, so claims settle in the order they were frozen. */
  order: number;
  claim: FundedSovereignCouponClaim;
  createdAt: Date;
  /** Set by the payout projection once the claim is paid. */
  settledTurn?: number;
  /** Written by the settlement journal while it publishes to this record; never set here. */
  pendingSettlementProjection?: unknown;
}

const OPEN_CLAIM = { settledTurn: { $exists: false } };
let claimIndexReady: Promise<unknown> | null = null;

function claimStore(db: Db) {
  const store = db.collection<SovereignCouponClaimRecord>(SOVEREIGN_COUPON_CLAIMS_COLLECTION);
  claimIndexReady ??= store
    .createIndex(
      { budgetId: 1, settledTurn: 1 },
      { name: "sovereignCouponClaims_budget_settled", background: true }
    )
    .catch((error) => {
      claimIndexReady = null;
      throw error;
    });
  return store;
}

/** Budget ids that still owe at least one stored coupon claim. */
export async function budgetIdsWithOpenSovereignCouponClaims(db: Db): Promise<Set<string>> {
  const ids = await claimStore(db).distinct("budgetId", OPEN_CLAIM);
  return new Set(ids.map(String));
}

/**
 * Lock keys for every document a coupon payout can credit, as
 * `<collection>:<id>`. Matches the credit legs built in payoutTransition.
 */
export function sovereignCouponHolderKeys(claim: FundedSovereignCouponClaim): string[] {
  return claim.holders.flatMap((holder) => {
    if (holder.kind === "publicFloat") return [`bondMarketPools:${claim.currencyCode}`];
    if (!holder.id) return [];
    if (holder.kind === "character") return [`characters:${holder.id}`];
    if (holder.kind === "imperial") return [`imperialCharacters:${holder.id}`];
    if (holder.kind === "corporation") return [`corporations:${holder.id}`];
    if (holder.kind === "fund") return [`indexFunds:${holder.id}`];
    if (holder.kind === "npp") return [`npps:${holder.id}`];
    return [];
  });
}

/** Holder lock keys of every stored unpaid coupon claim, by budget id. */
export async function openSovereignCouponHolderKeys(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await claimStore(db)
    .find(OPEN_CLAIM, {
      projection: {
        budgetId: 1,
        "claim.currencyCode": 1,
        "claim.holders.kind": 1,
        "claim.holders.id": 1,
      },
    })
    .toArray();
  const keys = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = keys.get(row.budgetId) ?? new Set<string>();
    for (const key of sovereignCouponHolderKeys(row.claim)) set.add(key);
    keys.set(row.budgetId, set);
  }
  return keys;
}

/** Unpaid claims for one budget, in book order. Legacy array claims are not included. */
export async function loadOpenSovereignCouponClaims(
  db: Db,
  budgetId: string
): Promise<FundedSovereignCouponClaim[]> {
  const rows = await claimStore(db)
    .find({ budgetId, ...OPEN_CLAIM })
    .sort({ "claim.dueTurn": 1, order: 1 })
    .toArray();
  return rows.map((row) => row.claim);
}

/**
 * Insert claim records. Unordered, so a record a concurrent or replayed install
 * already wrote fails alone with a duplicate key and every other record lands.
 */
async function insertClaimRecords(db: Db, records: SovereignCouponClaimRecord[]): Promise<void> {
  if (!records.length) return;
  try {
    await claimStore(db).insertMany(records, { ordered: false });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, writeErrors } = error as { code?: unknown; writeErrors?: unknown };
  if (code === 11000) return true;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.length > 0 &&
    writeErrors.every((row) => (row as { code?: unknown })?.code === 11000)
  );
}

async function findPriorPayouts(
  db: Db,
  claims: FundedSovereignCouponClaim[]
): Promise<Array<{ _id: string; status: string }>> {
  if (!claims.length) return [];
  return db
    .collection<{ _id: string; status: string }>("bankMoneyMoves")
    .find(
      {
        $or: claims.map((claim) => ({ _id: { $regex: `^${escapeRegex(claim.id)}:attempt:` } })),
        status: { $in: ["partial", "applied"] },
      },
      { projection: { _id: 1, status: 1 } }
    )
    .toArray();
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const claimIdOfMove = (moveId: string) => moveId.slice(0, moveId.indexOf(":attempt:"));

/**
 * Move a budget's legacy array claims into the claim store. A claim with a
 * partial or applied payout already in the journal stays in the array: its
 * frozen projection plan removes it from there, and moving it would leave that
 * plan pointing at nothing.
 */
async function migrateLegacyClaims(
  db: Db,
  budgetId: string,
  legacy: FundedSovereignCouponClaim[]
): Promise<FundedSovereignCouponClaim[]> {
  if (!legacy.length) return [];
  const priors = await findPriorPayouts(db, legacy);
  const pinned = new Set(priors.map((move) => claimIdOfMove(move._id)));
  const movable = legacy.filter((claim) => !pinned.has(claim.id));
  // A crash between the insert and the pull leaves a claim in both places; the
  // stored record wins and the pull below finishes the move.
  const stored = movable.length
    ? await claimStore(db)
        .find({ _id: { $in: movable.map((claim) => claim.id) } }, { projection: { _id: 1 } })
        .toArray()
    : [];
  const storedIds = new Set(stored.map((row) => row._id));
  await insertClaimRecords(
    db,
    movable.flatMap((claim, order) =>
      storedIds.has(claim.id)
        ? []
        : [{ _id: claim.id, budgetId, order, claim, createdAt: new Date() }]
    )
  );
  if (movable.length) {
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne(
        { _id: budgetId as FederalBudget["_id"] },
        { $pull: { sovereignCouponClaims: { id: { $in: movable.map((claim) => claim.id) } } } }
      );
  }
  return legacy.filter((claim) => pinned.has(claim.id));
}

function payoutTransition(
  claim: FundedSovereignCouponClaim,
  budgetId: string,
  attemptTurn: number
): BankingTransition {
  const key = `${claim.id}:attempt:${attemptTurn}`;
  const legs: BankingTransition["legs"] = [
    {
      kind: "debit",
      amount: claim.amountLocal,
      valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
      collection: "federalBudget",
      filter: { _id: budgetId, treasuryCashLocal: { $gte: claim.amountLocal } },
      path: "treasuryCashLocal",
      note: "Pay sovereign coupon claims from funded Treasury cash",
    },
  ];
  for (const holder of claim.holders) {
    if (holder.kind === "publicFloat") {
      legs.push({
        kind: "credit",
        amount: holder.amountLocal,
        valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
        collection: "bondMarketPools",
        filter: { _id: claim.currencyCode },
        path: "cashLocal",
        note: "Pay public-float sovereign coupon to its bond pool",
      });
    } else if (holder.kind === "character" || holder.kind === "imperial") {
      const path = holder.personalBalancePath;
      if (!path || !holder.id)
        throw new Error(`Invalid frozen sovereign coupon holder ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountLocal,
        valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
        collection: holder.kind === "character" ? "characters" : "imperialCharacters",
        filter: { _id: new ObjectId(holder.id) },
        path,
        note: "Pay frozen sovereign coupon to personal cash",
      });
    } else if (holder.kind === "corporation") {
      if (!holder.id) throw new Error(`Missing corporation in sovereign coupon ${claim.id}`);
      const payeeRate = holder.payeeLocalPerAnchor;
      const payeeCurrency = holder.payeeCurrencyCode;
      if (!payeeRate || !payeeCurrency)
        throw new Error(`Missing frozen corporate FX quote for ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor * payeeRate,
        valuation: { currencyCode: payeeCurrency, localPerAnchor: payeeRate },
        collection: "corporations",
        filter: {
          _id: new ObjectId(holder.id),
          ...(holder.payeeCurrencyFieldPresent
            ? { liquidCurrencyCode: holder.payeeCurrencyFieldValue ?? null }
            : { liquidCurrencyCode: { $exists: false } }),
          ...(holder.payeeCurrencyUsesCountryFallback ? { countryId: holder.payeeCountryId } : {}),
        },
        path: "liquidCapital",
        note: "Pay frozen sovereign coupon to corporate cash",
      });
    } else if (holder.kind === "fund") {
      if (!holder.id) throw new Error(`Missing index fund in sovereign coupon ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor,
        valuation: { currencyCode: "ANCHOR", localPerAnchor: 1 },
        collection: "indexFunds",
        filter: { _id: new ObjectId(holder.id) },
        path: "cashAnchor",
        note: "Pay frozen sovereign coupon to index-fund cash",
      });
    } else if (holder.kind === "npp") {
      if (!holder.id) throw new Error(`Missing NPP in sovereign coupon ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor,
        valuation: { currencyCode: "ANCHOR", localPerAnchor: 1 },
        collection: "npps",
        filter: { _id: new ObjectId(holder.id) },
        path: "nppInvestmentCashAnchor",
        note: "Pay frozen sovereign coupon to NPP investment cash",
      });
    }
  }
  return {
    key,
    kind: "sovereign_coupon_funded_payout",
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs,
    projections: [
      {
        collection: SOVEREIGN_COUPON_CLAIMS_COLLECTION,
        filter: { _id: claim.id, budgetId },
        update: { $set: { settledTurn: attemptTurn } },
        note: "Mark paid sovereign coupon claim settled",
      },
      ...claim.holders
        .filter((holder) => holder.kind === "publicFloat")
        .map((holder) => ({
          collection: "bondMarketPools",
          filter: { _id: claim.currencyCode },
          update: { $inc: { "lifetime.couponsIn": holder.amountLocal } },
          note: "Record funded public-float coupon receipt",
        })),
    ],
    event: {
      kind: "monetary.executed",
      command: "turn.sovereignCoupon.fundedPayout",
      subjectType: "country",
      subjectId: claim.countryId,
      amount: claim.amountLocal,
      meta: { claimId: claim.id, bondId: claim.bondId },
    },
  };
}

/** Freeze due-turn holder quotes before attempts; funded payout is journaled as one balanced native-currency move. */
export async function settleFundedSovereignCoupons(
  db: Db,
  budget: Pick<
    FederalBudget,
    "_id" | "countryId" | "sovereignCouponClaims" | "sovereignCouponFrozenThrough"
  >,
  input: {
    turn: number;
    bonds: Bond[];
    anchorRate: number;
    forexEnabled: boolean;
    corporateQuotes: ReadonlyMap<string, SovereignCouponCorporationQuote>;
  }
): Promise<void> {
  const budgetId = String(budget._id);
  const pinnedLegacy = await migrateLegacyClaims(db, budgetId, budget.sovereignCouponClaims ?? []);
  const claimById = new Map<string, FundedSovereignCouponClaim>(
    pinnedLegacy.map((claim) => [claim.id, claim])
  );
  for (const claim of await loadOpenSovereignCouponClaims(db, budgetId))
    claimById.set(claim.id, claim);

  // Freeze this turn's claims. The record is written before the frozen-through
  // mark, so a crash between the two re-installs the same id (a no-op) rather
  // than losing the claim.
  const fresh: SovereignCouponClaimRecord[] = [];
  for (const bond of input.bonds) {
    if (
      bond.issuerType !== "sovereign" ||
      bond.defaulted ||
      bond.matured ||
      !bondAccruesCoupon(bond)
    )
      continue;
    const bondId = bond._id.toHexString();
    const claimId = `sovereign-coupon:${bondId}:${input.turn}`;
    if (claimById.has(claimId)) continue;
    if ((budget.sovereignCouponFrozenThrough?.[`b${bondId}`] ?? -1) >= input.turn) continue;
    const snapshot: SovereignCouponBondSnapshot = {
      id: bond._id.toHexString(),
      countryId: String(bond.countryId ?? ""),
      currencyCode: bond.currencyCode,
      couponRate: bond.couponRate,
      publicFloat: bond.publicFloat,
      holders: (bond.holders ?? []).map((holder) => {
        if (holder.bankId || holder.bankTreasuryTradeId)
          return { kind: "bank", units: holder.units };
        if (holder.characterId)
          return { kind: "character", id: holder.characterId.toHexString(), units: holder.units };
        if (holder.imperialCharacterId)
          return {
            kind: "imperial",
            id: holder.imperialCharacterId.toHexString(),
            units: holder.units,
          };
        if (holder.corporationId)
          return {
            kind: "corporation",
            id: holder.corporationId.toHexString(),
            units: holder.units,
          };
        if (holder.fundId)
          return { kind: "fund", id: holder.fundId.toHexString(), units: holder.units };
        if (holder.nppId)
          return { kind: "npp", id: holder.nppId.toHexString(), units: holder.units };
        return { kind: "bank", units: holder.units };
      }),
    };
    const claim = freezeSovereignCouponClaim({
      bond: snapshot,
      turn: input.turn,
      anchorRate: input.anchorRate,
      forexEnabled: input.forexEnabled,
      corporateQuotes: input.corporateQuotes,
    });
    if (!claim) continue;
    fresh.push({ _id: claim.id, budgetId, order: fresh.length, claim, createdAt: new Date() });
  }
  if (fresh.length) {
    // A replayed install keeps the claim frozen the first time, and a claim
    // already paid stays paid.
    const existing = await claimStore(db)
      .find({ _id: { $in: fresh.map((row) => row._id) } })
      .toArray();
    const existingById = new Map(existing.map((row) => [row._id, row]));
    await insertClaimRecords(
      db,
      fresh.filter((row) => !existingById.has(row._id))
    );
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budget._id },
      {
        $max: Object.fromEntries(
          fresh.map((row) => [
            `sovereignCouponFrozenThrough.b${row.claim.bondId}`,
            row.claim.dueTurn,
          ])
        ),
      }
    );
    for (const row of fresh) {
      const saved = existingById.get(row._id);
      if (saved?.settledTurn !== undefined) continue;
      claimById.set(row._id, saved?.claim ?? row.claim);
    }
  }

  const claims = [...claimById.values()].sort((a, b) => a.dueTurn - b.dueTurn);
  const priorMoves = await findPriorPayouts(db, claims);
  const targetReadyClaimIds = await loadCouponTargetReadiness(db, claims);
  // Claims a grouped receipt already owns settle only through that receipt.
  // Only a receipt whose every leg and projection landed closes its members;
  // one refused on resume moved no cash and leaves them owed.
  const batches = await loadCouponBatches(db, budgetId, claims, input.turn);
  const landed: CouponBatchRecord[] = [];
  const batched = new Set<string>();
  for (const batch of batches) {
    if (batch.status === "rejected") continue;
    if (!batchSettled(batch)) {
      const resumed = await resumeSettlement(db, batch._id);
      if (resumed.status === "partial") return;
      if (!settlementLanded(resumed)) continue;
    }
    landed.push(batch);
    for (const id of batchMembers(batch)) batched.add(id);
  }
  await markBatchMembersSettled(
    db,
    budgetId,
    landed,
    claims.filter((claim) => batched.has(claim.id))
  );

  // Unpaid claims stay queued, so an unfunded Treasury carries one claim per
  // bond per turn of arrears. Attempting each through the journal writes a
  // rejected receipt and a failed guarded debit for every one of them, which
  // grows the phase without bound. Skip claims this snapshot of cash cannot
  // cover. The guarded debit remains the authority: a stale snapshot only
  // defers a claim one turn or lets the guard reject it as before. Read after
  // resumed batches, so their landed debits are not offered again.
  let fundableCash = 0;
  if (claims.length) {
    const cash = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budget._id }, { projection: { treasuryCashLocal: 1 } });
    const value = (cash as { treasuryCashLocal?: unknown } | null)?.treasuryCashLocal;
    fundableCash = typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  // At most one grouped receipt per Treasury and turn, holding at most
  // MAX_BATCH_CLAIMS claims. A claim that could join a batch but finds this
  // turn's batch already written or full stays owed for the next turn's batch,
  // so a replayed turn never falls back to one journal receipt per claim.
  const batchOpen = !batches.some((batch) => batch._id === couponBatchKey(budgetId, input.turn));
  const grouped: FundedSovereignCouponClaim[] = [];
  for (const claim of claims) {
    if (batched.has(claim.id)) continue;
    const attempt = Math.max(input.turn, claim.dueTurn);
    const prior =
      priorMoves.find(
        (move) => move._id.startsWith(`${claim.id}:attempt:`) && move.status === "partial"
      ) ??
      priorMoves.find(
        (move) => move._id.startsWith(`${claim.id}:attempt:`) && move.status === "applied"
      );
    if (!prior && !targetReadyClaimIds.has(claim.id)) continue;
    if (!prior && claim.amountLocal > fundableCash) continue;
    // Claims in one currency whose holders are the bond pool, index funds, NPPs
    // or personal cash share a grouped receipt. A claim with its own journaled
    // attempt, a corporate holder, or a second currency keeps its own receipt.
    if (
      !prior &&
      isBatchable(claim, budgetId, attempt) &&
      claim.currencyCode === (grouped[0]?.currencyCode ?? claim.currencyCode)
    ) {
      if (batchOpen && grouped.length < MAX_BATCH_CLAIMS) {
        grouped.push(claim);
        fundableCash -= claim.amountLocal;
      }
      continue;
    }
    const result = prior
      ? await resumeSettlement(db, prior._id)
      : await settleTransition(db, payoutTransition(claim, budgetId, attempt));
    if (result.status === "partial") return;
    if (!prior && result.status === "applied") fundableCash -= claim.amountLocal;
    // A wholly rejected source guard has no landed cash leg. Keep the immutable claim for the next turn.
  }
  if (grouped.length) {
    const transition = batchPayoutTransition(grouped, budgetId, input.turn);
    const result = await settleTransition(db, transition);
    if (result.status === "partial") return;
    if (settlementLanded(result)) {
      // A replay keeps the membership the receipt was first written with.
      const saved = await db
        .collection<CouponBatchRecord>("bankMoneyMoves")
        .findOne({ _id: transition.key }, { projection: BATCH_PROJECTION });
      if (saved && batchSettled(saved))
        await markBatchMembersSettled(db, budgetId, [saved], grouped);
    }
    // A rejected batch moved no cash, and a replay another attempt still owns
    // has not finished; either way its claims stay queued for the next turn.
  }

  // Paid records are only history once their receipt is acknowledged; keep
  // anything a journal may still publish to.
  await claimStore(db).deleteMany({
    budgetId,
    settledTurn: { $lt: input.turn },
    pendingSettlementProjection: { $exists: false },
  });
}

type CouponBatchRecord = {
  _id: string;
  status?: string;
  projectionsCompletedAt?: Date;
  projections?: { applied?: boolean }[];
  event?: { meta?: { claimIds?: unknown } };
};

const BATCH_PROJECTION = {
  _id: 1,
  status: 1,
  projectionsCompletedAt: 1,
  "projections.applied": 1,
  "event.meta.claimIds": 1,
} as const;

/** Grouped receipt key: one per Treasury and attempt turn. */
export function couponBatchKey(budgetId: string, turn: number): string {
  return `sovereign-coupon-batch:${budgetId}:${turn}`;
}

const batchTurn = (batch: CouponBatchRecord) =>
  Number(batch._id.slice(batch._id.lastIndexOf(":") + 1));

/**
 * Every leg and projection of the receipt landed. A batch with no pool credit
 * carries no projection, and the journal stamps completion only on a receipt
 * that published projections.
 */
const batchSettled = (batch: CouponBatchRecord) =>
  batch.status === "applied" &&
  (batch.projectionsCompletedAt !== undefined || (batch.projections?.length ?? 0) === 0);

/**
 * The settlement delivered its money and projections. A replay carrying an
 * error is a key another attempt owns and has not finished.
 */
const settlementLanded = (result: SettlementResult) =>
  result.status === "applied" || (result.status === "replayed" && !result.error);

const batchMembers = (batch: CouponBatchRecord): string[] =>
  String(batch.event?.meta?.claimIds ?? "")
    .split(",")
    .filter(Boolean);

/**
 * Every grouped receipt that could own a queued claim. A batch is attempted on
 * or after the due turn of each claim it holds, so the exact keys from the
 * oldest open due turn through this turn cover them all without a prefix scan.
 */
async function loadCouponBatches(
  db: Db,
  budgetId: string,
  claims: FundedSovereignCouponClaim[],
  turn: number
): Promise<CouponBatchRecord[]> {
  if (!claims.length) return [];
  const first = Math.min(...claims.map((claim) => claim.dueTurn));
  const keys: string[] = [];
  for (let t = first; t <= turn; t++) keys.push(couponBatchKey(budgetId, t));
  return db
    .collection<CouponBatchRecord>("bankMoneyMoves")
    .find({ _id: { $in: keys } }, { projection: BATCH_PROJECTION })
    .toArray();
}

/**
 * Close the claim records a landed batch paid. The receipt, not the record, is
 * the authority: a crash before this write leaves the record open and the next
 * attempt finds it in the batch membership and closes it here, paying nothing.
 */
async function markBatchMembersSettled(
  db: Db,
  budgetId: string,
  batches: CouponBatchRecord[],
  open: FundedSovereignCouponClaim[]
): Promise<void> {
  const openIds = new Set(open.map((claim) => claim.id));
  const ops = batches.flatMap((batch) => {
    const ids = batchMembers(batch).filter((id) => openIds.has(id));
    if (!ids.length) return [];
    return [
      {
        updateMany: {
          filter: { _id: { $in: ids }, budgetId, ...OPEN_CLAIM },
          update: { $set: { settledTurn: batchTurn(batch) } },
        },
      },
    ];
  });
  if (ops.length) await claimStore(db).bulkWrite(ops, { ordered: false });
}

/**
 * Claims per grouped receipt. The receipt stores its member ids, so this bounds
 * the receipt document and the claim close-out write; a larger backlog drains
 * over the following turns.
 */
export const MAX_BATCH_CLAIMS = 2000;

/**
 * A claim may join a grouped receipt when every credit targets a document by id
 * alone and its own per-claim receipt balances. Corporate credits carry a payee
 * currency guard per claim, so they keep the per-claim receipt.
 */
function isBatchable(claim: FundedSovereignCouponClaim, budgetId: string, attempt: number) {
  if (claim.holders.some((holder) => holder.kind === "corporation")) return false;
  try {
    return checkBalancedTransfer(payoutTransition(claim, budgetId, attempt).legs).length === 0;
  } catch {
    return false;
  }
}

/**
 * One balanced receipt for many claims in one currency. It is the per-claim
 * receipts added together: one Treasury debit for the sum of the claims, and
 * one credit per payee holding the sum of that payee's per-claim credits, each
 * valued at the frozen quotes it summed. The debit is valued at the anchor sum
 * of the credits, so the receipt nets exactly. Each claim keeps its own frozen
 * quote on its record, and leaves the queue only after the receipt lands.
 */
function batchPayoutTransition(
  claims: FundedSovereignCouponClaim[],
  budgetId: string,
  turn: number
): BankingTransition {
  const currencyCode = claims[0].currencyCode;
  const credits = new Map<
    string,
    { leg: TransitionLeg; currencyCode: string; amount: number; anchor: number }
  >();
  const couponsIn = new Map<string, number>();
  let amount = 0;
  for (const claim of claims) {
    amount += claim.amountLocal;
    const single = payoutTransition(claim, budgetId, Math.max(turn, claim.dueTurn));
    for (const leg of single.legs) {
      if (leg.kind !== "credit" || !leg.valuation) continue;
      const target = `${leg.collection}|${String((leg.filter as { _id?: unknown })._id)}|${leg.path}|${leg.valuation.currencyCode}`;
      const row = credits.get(target) ?? {
        leg,
        currencyCode: leg.valuation.currencyCode,
        amount: 0,
        anchor: 0,
      };
      row.amount += leg.amount;
      row.anchor += leg.amount / leg.valuation.localPerAnchor;
      credits.set(target, row);
    }
    for (const holder of claim.holders) {
      if (holder.kind !== "publicFloat") continue;
      couponsIn.set(
        claim.currencyCode,
        (couponsIn.get(claim.currencyCode) ?? 0) + holder.amountLocal
      );
    }
  }
  let creditAnchor = 0;
  const creditLegs: TransitionLeg[] = [...credits.values()].map((row) => {
    creditAnchor += row.anchor;
    return {
      ...row.leg,
      amount: row.amount,
      valuation: { currencyCode: row.currencyCode, localPerAnchor: row.amount / row.anchor },
    };
  });
  return {
    key: couponBatchKey(budgetId, turn),
    kind: "sovereign_coupon_funded_batch_payout",
    turn,
    currency: currencyCode,
    legs: [
      {
        kind: "debit",
        amount,
        valuation: { currencyCode, localPerAnchor: amount / creditAnchor },
        collection: "federalBudget",
        filter: { _id: budgetId, treasuryCashLocal: { $gte: amount } },
        path: "treasuryCashLocal",
        note: "Pay sovereign coupon claims from funded Treasury cash",
      },
      ...creditLegs,
    ],
    projections: [...couponsIn].map(([pool, inc]) => ({
      collection: "bondMarketPools",
      filter: { _id: pool },
      update: { $inc: { "lifetime.couponsIn": inc } },
      note: "Record funded public-float coupon receipts",
    })),
    event: {
      kind: "monetary.executed",
      command: "turn.sovereignCoupon.fundedBatchPayout",
      subjectType: "country",
      subjectId: claims[0].countryId,
      amount,
      meta: { claimIds: claims.map((claim) => claim.id).join(","), claims: claims.length },
    },
  };
}

async function loadCouponTargetReadiness(
  db: Db,
  claims: FundedSovereignCouponClaim[]
): Promise<Set<string>> {
  const poolCurrencies = new Set(
    claims.flatMap((claim) =>
      claim.holders.some((holder) => holder.kind === "publicFloat") ? [claim.currencyCode] : []
    )
  );
  await Promise.all(
    [...poolCurrencies].map((currencyCode) =>
      db
        .collection<{ _id: string }>("bondMarketPools")
        .updateOne(
          { _id: currencyCode },
          { $setOnInsert: { targetCashLocal: 0, createdAt: new Date() } },
          { upsert: true }
        )
    )
  );
  const collections = new Map<string, Set<string>>();
  for (const claim of claims) {
    for (const holder of claim.holders) {
      if (!holder.id) continue;
      const collection = targetCollection(holder.kind);
      if (!collection) continue;
      const ids = collections.get(collection) ?? new Set<string>();
      ids.add(holder.id);
      collections.set(collection, ids);
    }
  }
  const foundIds = new Map<string, Set<string>>();
  const corporationsById = new Map<string, Corporation>();
  for (const [collection, ids] of collections) {
    const found =
      collection === "corporations"
        ? await db
            .collection<Corporation>(collection)
            .find(
              { _id: { $in: [...ids].map((id) => new ObjectId(id)) } },
              { projection: { _id: 1, countryId: 1, liquidCurrencyCode: 1 } }
            )
            .toArray()
        : await db
            .collection<{ _id: ObjectId }>(collection)
            .find(
              { _id: { $in: [...ids].map((id) => new ObjectId(id)) } },
              { projection: { _id: 1 } }
            )
            .toArray();
    foundIds.set(collection, new Set(found.map((row) => row._id.toHexString())));
    if (collection === "corporations") {
      for (const corp of found as Corporation[]) corporationsById.set(corp._id.toHexString(), corp);
    }
  }
  const ready = new Set<string>();
  for (const claim of claims) {
    const hasAllTargets = claim.holders.every((holder) => {
      if (holder.kind === "publicFloat") return poolCurrencies.has(claim.currencyCode);
      if (!holder.id) return false;
      const collection = targetCollection(holder.kind);
      if (!collection || !foundIds.get(collection)?.has(holder.id)) return false;
      if (holder.kind !== "corporation") return true;
      const corp = corporationsById.get(holder.id);
      return (
        !!corp &&
        resolveCorpLiquidCurrencyCode(corp) === holder.payeeCurrencyCode &&
        (holder.payeeCurrencyFieldPresent
          ? corp.liquidCurrencyCode === holder.payeeCurrencyFieldValue
          : corp.liquidCurrencyCode === undefined) &&
        (!holder.payeeCurrencyUsesCountryFallback ||
          String(corp.countryId ?? "") === holder.payeeCountryId)
      );
    });
    if (hasAllTargets) ready.add(claim.id);
  }
  return ready;
}

function targetCollection(
  kind: FundedSovereignCouponClaim["holders"][number]["kind"]
): string | null {
  if (kind === "character") return "characters";
  if (kind === "imperial") return "imperialCharacters";
  if (kind === "corporation") return "corporations";
  if (kind === "fund") return "indexFunds";
  if (kind === "npp") return "npps";
  return null;
}
