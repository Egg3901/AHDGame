import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type DebitResult = { ok: true; newBalance: number } | { ok: false; error: string };

type CashGuardOptions = { session?: ClientSession };

function mongoOptions(options?: CashGuardOptions): { session: ClientSession } | undefined {
  return options?.session ? { session: options.session } : undefined;
}

/**
 * Atomically debit `amount` from a character's wallet using a single-document
 * `findOneAndUpdate` with a `$gte` filter on the balance field. Race-safe:
 * MongoDB applies the filter and the increment in the same atomic step, so
 * two concurrent requests can never both succeed when only one balance fits.
 *
 * Pre-forex (legacy) characters store cash in `cashOnHand`. Post-forex
 * characters use `currencyBalances.personal.<code>`. The dispatch matches
 * `buildPersonalBalanceInc` to keep credit/debit semantics symmetric.
 *
 * Why this exists: the bond/share purchase routes previously did a read-then-
 * write where the cash check ran on a freshly fetched copy of the character
 * doc and the deduction was a separate `updateOne` with no balance filter.
 * Concurrent requests against the same character could both pass the check on
 * stale data, then both writes would deduct (over-deducting), or — the live
 * failure mode observed against the production DB — one of the writes would
 * be silently dropped while the bond holders array was still incremented.
 * The result was multi-billion-dollar phantom credits to top wealth-list
 * players. Forcing every cash debit through this helper makes that class of
 * mismatch impossible: the holder credit only proceeds after the cash debit
 * has provably succeeded, and any downstream failure refunds via
 * `refundCharacterCash`.
 */
export async function atomicallyDebitCharacterCash(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode,
  amount: number,
  forexEnabled: boolean,
  options?: CashGuardOptions
): Promise<DebitResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }

  const balanceField = forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand";

  const result = await db.collection("characters").findOneAndUpdate(
    { _id: characterId, [balanceField]: { $gte: amount } },
    { $inc: { [balanceField]: -amount }, $set: { updatedAt: new Date() } },
    {
      returnDocument: "after",
      projection: { currencyBalances: 1, cashOnHand: 1 },
      ...mongoOptions(options),
    }
  );

  if (!result) {
    return { ok: false, error: "Insufficient funds" };
  }

  const newBalance = forexEnabled
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((result as any).currencyBalances?.personal?.[currency] ?? 0)
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((result as any).cashOnHand ?? 0);

  return { ok: true, newBalance };
}

/**
 * Refund a previously-debited amount when a downstream write fails.
 * Idempotent — pure `$inc`, never gates on balance. Use only after a
 * successful `atomicallyDebitCharacterCash` when a follow-up write throws.
 */
export async function refundCharacterCash(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode,
  amount: number,
  forexEnabled: boolean,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const balanceField = forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand";
  await db
    .collection("characters")
    .updateOne(
      { _id: characterId },
      { $inc: { [balanceField]: amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}

/**
 * Atomically debit a corporation's `liquidCapital`. Same race-safe pattern:
 * single-document `findOneAndUpdate` with `$gte`. Used by routes where a
 * corporation acts as buyer (corp buying bonds, corp buying shares of
 * another corp). `amount` is in the corp's `liquidCurrencyCode` — callers
 * must convert to that unit before calling this helper.
 *
 * ## The bank reserve floor
 *
 * A chartered bank keeps its depositors' money in the same `liquidCapital`
 * field as its own operating cash. There is one pot and two kinds of claim on
 * it, and until this guard there was nothing stopping the CEO spending the
 * depositors' half: buy capacity, buy shares, buy bonds, pay it out, all from
 * money the bank owes back on demand. The reserve ratio existed but it was
 * measured after the fact, so it recorded the raid instead of preventing it.
 *
 * While a charter is active this debit additionally refuses to take
 * `liquidCapital` below `bankCharter.reserveFloor` (deposits × the central
 * bank's reserve requirement, recomputed each banking turn). The check rides in
 * the same atomic filter as the balance check, via `$expr`, so it costs no
 * extra read and cannot be raced past.
 *
 * The turn engine deliberately does NOT go through this helper — deposit
 * interest, insurance premiums and loan servicing all move bank cash directly.
 * Those are the bank meeting its obligations, not the corporation spending its
 * depositors' money, and a floor that blocked them would strand a bank that
 * owed interest it was holding the cash for.
 */
export async function atomicallyDebitCorpLiquidCapital(
  db: Db,
  corporationId: ObjectId,
  amountInCorpCapitalUnits: number,
  options?: CashGuardOptions
): Promise<DebitResult> {
  if (!Number.isFinite(amountInCorpCapitalUnits) || amountInCorpCapitalUnits <= 0) {
    return { ok: false, error: "Invalid amount" };
  }
  const result = await db.collection("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      liquidCapital: { $gte: amountInCorpCapitalUnits },
      $expr: {
        $gte: [
          { $subtract: [{ $ifNull: ["$liquidCapital", 0] }, amountInCorpCapitalUnits] },
          {
            $cond: [
              { $eq: [{ $ifNull: ["$bankCharter.status", null] }, "active"] },
              { $max: [0, { $ifNull: ["$bankCharter.reserveFloor", 0] }] },
              0,
            ],
          },
        ],
      },
    },
    { $inc: { liquidCapital: -amountInCorpCapitalUnits }, $set: { updatedAt: new Date() } },
    { returnDocument: "after", projection: { liquidCapital: 1 }, ...mongoOptions(options) }
  );
  if (!result) {
    // Only on the failure path: one extra read to say WHICH limit was hit, so a
    // bank CEO is not told they are broke when they are actually at the floor.
    const doc = await db
      .collection("corporations")
      .findOne(
        { _id: corporationId },
        { projection: { liquidCapital: 1, bankCharter: 1 }, ...mongoOptions(options) }
      );
    const liquid = typeof doc?.liquidCapital === "number" ? doc.liquidCapital : 0;
    const charter = doc?.bankCharter as { status?: string; reserveFloor?: number } | undefined;
    const floor =
      charter?.status === "active" && typeof charter.reserveFloor === "number"
        ? Math.max(0, charter.reserveFloor)
        : 0;
    if (floor > 0 && liquid >= amountInCorpCapitalUnits) {
      return {
        ok: false,
        error: "Bank reserve floor: that spend would dip into depositors' reserves",
      };
    }
    return { ok: false, error: "Insufficient corporate funds" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, newBalance: (result as any).liquidCapital ?? 0 };
}

/**
 * Refund a corp `liquidCapital` debit. Idempotent. Same pattern as
 * `refundCharacterCash`. Use only after a successful debit when a follow-up
 * write throws.
 */
export async function refundCorpLiquidCapital(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .collection("corporations")
    .updateOne(
      { _id: corporationId },
      { $inc: { liquidCapital: amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}

/**
 * Credit a corp's `liquidCapital` (in the corp's own currency units). Used when
 * a public-float share buy injects the buyer's payment into the issuer treasury
 * (treasury-backed market maker) so float trades conserve money instead of the
 * float minting/burning cash with no counterparty. Returns the new balance, or
 * null if the corp was not found.
 *
 * When `alsoTrackIssuanceProceeds` is true, the same atomic write also increments
 * `shareIssuanceProceeds` by `amount`. This is how the issuer realizes — and the
 * share-price book-floor lever records — proceeds from its OWN float as that float
 * is actually bought (issuance itself no longer pre-credits either field; see Bug
 * #0624). Callers that debit/credit a BUYER corp (corp-buys-bond, corp-buys-other-
 * corp-shares, escrow) must leave this false so the field is untouched.
 */
export async function creditCorpLiquidCapital(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  alsoTrackIssuanceProceeds = false,
  options?: CashGuardOptions
): Promise<number | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const result = await db.collection("corporations").findOneAndUpdate(
    { _id: corporationId },
    {
      $inc: {
        liquidCapital: amount,
        ...(alsoTrackIssuanceProceeds ? { shareIssuanceProceeds: amount } : {}),
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after", projection: { liquidCapital: 1 }, ...mongoOptions(options) }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result ? ((result as any).liquidCapital ?? 0) : null;
}

/**
 * Decrement a corp's `shareIssuanceProceeds` by `amount` (the corp's own currency
 * units) when float shares are sold back INTO the issuer's float. Mirrors the
 * `alsoTrackIssuanceProceeds` credit on the buy side so the share-price book-floor
 * lever tracks realized proceeds symmetrically.
 *
 * Deliberately does NOT touch `liquidCapital` — the seller's cash and the issuer
 * buyback debit are handled by the existing `atomicallyDebitCorpLiquidCapital` /
 * `refundCorpLiquidCapital` flow, which must stay exactly reversible. This is a
 * best-effort, fire-and-forget side write: call it AFTER a sell has committed so a
 * hiccup here can never break a committed sell or mint cash.
 *
 * The field is allowed to go negative (no floor): the price formula already does
 * `Math.max(0, liquidCapital - shareIssuanceProceeds)`, so a negative value only
 * raises the book floor toward true liquidCapital (bounded, benign), and keeping a
 * plain `$inc` preserves exact reversibility against the buy-side credit.
 */
export async function decrementCorpIssuanceProceeds(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .collection("corporations")
    .updateOne(
      { _id: corporationId },
      { $inc: { shareIssuanceProceeds: -amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}

/**
 * Credit a corporation's market-making escrow (a float BUY in escrow mode).
 * No gate — escrow is allowed to be any sign. Amount in liquidCurrencyCode units.
 */
export async function creditCorpShareEscrow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .collection("corporations")
    .updateOne(
      { _id: corporationId },
      { $inc: { shareEscrowBalance: amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}

/**
 * Debit a corporation's market-making escrow (a float SELL in escrow mode).
 * No gate — the balance MAY go negative (a tracked buyback debt).
 *
 * @deprecated Prefer `debitCorpShareEscrowFloored`, which floors the escrow at
 * zero and spills any shortfall onto real `liquidCapital`. The unfloored debit
 * let `shareEscrowBalance` run arbitrarily negative — cash was paid to the
 * seller with no corresponding debit against any real balance (money printed),
 * and the phantom liability then destroyed real value at takeover/nationalization
 * (which transfer `liquidCapital + escrow`). Kept only for the reverse path.
 */
export async function debitCorpShareEscrow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .collection("corporations")
    .updateOne(
      { _id: corporationId },
      { $inc: { shareEscrowBalance: -amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}

/** How a floored escrow debit split across the escrow pot and the treasury. */
export type EscrowDebitSplit = { escrowDebited: number; treasuryDebited: number };

/**
 * Debit a float SELL against the market-making escrow, but FLOOR the escrow at
 * zero: only the genuinely-collected (positive) escrow balance can pay, and any
 * shortfall is drawn from real `liquidCapital` instead. In one atomic pipeline
 * update:
 *   cover     = min(amount, max(0, shareEscrowBalance))   // escrow can only spend what it holds
 *   escrow   -= cover
 *   liquid   -= (amount - cover)                          // shortfall from the treasury
 *
 * This keeps the seller paid with REAL corp money (escrow's collected buyer cash
 * first, treasury for the rest) instead of minting cash into a bottomless
 * negative escrow. It never blocks the trade — an under-funded corp simply draws
 * down (and may go negative on) `liquidCapital`, exactly as instant mode already
 * behaves and as the financial-distress path already handles. `shareEscrowBalance`
 * can no longer drift below zero.
 *
 * Returns the split so a rollback can reverse both legs exactly.
 */
export async function debitCorpShareEscrowFloored(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  options?: CashGuardOptions
): Promise<EscrowDebitSplit> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { escrowDebited: 0, treasuryDebited: 0 };
  }
  const now = new Date();
  // returnDocument:"before" gives the pre-state so we can report the exact split.
  const before = await db.collection("corporations").findOneAndUpdate(
    { _id: corporationId },
    [
      {
        $set: {
          // remainder = amount - min(amount, max(0, escrow))  → the treasury share
          liquidCapital: {
            $subtract: [
              { $ifNull: ["$liquidCapital", 0] },
              {
                $subtract: [
                  amount,
                  { $min: [amount, { $max: [0, { $ifNull: ["$shareEscrowBalance", 0] }] }] },
                ],
              },
            ],
          },
          shareEscrowBalance: {
            $subtract: [
              { $ifNull: ["$shareEscrowBalance", 0] },
              { $min: [amount, { $max: [0, { $ifNull: ["$shareEscrowBalance", 0] }] }] },
            ],
          },
          updatedAt: now,
        },
      },
    ],
    {
      returnDocument: "before",
      projection: { shareEscrowBalance: 1 },
      ...mongoOptions(options),
    }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preEscrow = before ? ((before as any).shareEscrowBalance ?? 0) : 0;
  const escrowDebited = Math.min(amount, Math.max(0, preEscrow));
  return { escrowDebited, treasuryDebited: amount - escrowDebited };
}

/**
 * Atomically debit an imperial character's wallet. Imperial characters use
 * the same `currencyBalances.personal.<code>` shape as regular characters
 * (post-forex). Pre-forex they fall back to `cashOnHand`. Lives in the
 * `imperialCharacters` collection.
 */
export async function atomicallyDebitImperialCash(
  db: Db,
  imperialId: ObjectId,
  currency: CurrencyCode,
  amount: number,
  forexEnabled: boolean,
  options?: CashGuardOptions
): Promise<DebitResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }
  const balanceField = forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand";
  const result = await db.collection("imperialCharacters").findOneAndUpdate(
    { _id: imperialId, [balanceField]: { $gte: amount } },
    { $inc: { [balanceField]: -amount }, $set: { updatedAt: new Date() } },
    {
      returnDocument: "after",
      projection: { currencyBalances: 1, cashOnHand: 1 },
      ...mongoOptions(options),
    }
  );
  if (!result) return { ok: false, error: "Insufficient funds" };
  const newBalance = forexEnabled
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((result as any).currencyBalances?.personal?.[currency] ?? 0)
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((result as any).cashOnHand ?? 0);
  return { ok: true, newBalance };
}

/**
 * Refund an imperial cash debit. Idempotent.
 */
export async function refundImperialCash(
  db: Db,
  imperialId: ObjectId,
  currency: CurrencyCode,
  amount: number,
  forexEnabled: boolean,
  options?: CashGuardOptions
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const balanceField = forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand";
  await db
    .collection("imperialCharacters")
    .updateOne(
      { _id: imperialId },
      { $inc: { [balanceField]: amount }, $set: { updatedAt: new Date() } },
      mongoOptions(options)
    );
}
