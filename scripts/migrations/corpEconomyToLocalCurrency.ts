/**
 * One-time migration (v0.2.6): convert every corp-economic money field from
 * ₳ (anchor) storage to each corp's `liquidCurrencyCode` storage.
 *
 * Writes:
 *   - `corporations.{marketingBudget, logisticsBudget, ceoSalary, sharePrice}`
 *   - `corporateSectors.{revenue, currentGrowthCost}`
 *   - `corporationHistory.*` scalar money columns (see CORP_HISTORY_MONEY_FIELDS)
 *   - `corporationHistory.{taxPaidByCountry, taxPaidByState}` Record<string, number> maps
 *   - `corporationHistory.currencyCode` stamp on any row missing it
 *   - `corporations.shareholders[].avgCostPerShare` — weighted-average cost basis
 *     (pre-Task-18A this was ₳; post-Task-18A is local, so old entries get scaled
 *     so the weighted-average formula in `creditShares` stays unit-consistent)
 *
 * Cancels (rather than rescales) every open limit order, pending offer, and
 * open listing so the ₳ → target-local storage cutover doesn't leave partial-
 * fill / offer-bounds math straddling two currencies:
 *   - `shareOrders` (open) → status "cancelled"; buy-order escrow refunded
 *      to placer wallet (character or corp) in their home currency; corp
 *      sell-order reserved shares restored to placer's shareholder entry.
 *   - `shareOffers` (pending) → status "cancelled"; buyer escrow refunded
 *      to buyer wallet.
 *   - `shareListings` (open) → status "cancelled"; reserved shares restored
 *      to seller's shareholder entry (character or corp).
 * Users lose no money; open-order intent can be trivially re-placed
 * post-deploy.
 *
 * Intentionally skipped:
 *   - `marketCapHistory.*` — per-turn global aggregates, written in ₳; stays ₳
 *
 * History backfill follows option 3 from the design spec: every snapshot value
 * is expressed at TODAY's rate so charts stay visually continuous across the
 * migration moment. Historical FX accuracy is intentionally sacrificed.
 *
 * Idempotent via `migrationsRun` marker doc (_id = "corp-economy-to-local-currency").
 * Re-running is a no-op — the marker is only written at the very end, so a
 * clean successful run always records its completion.
 *
 * CRASH RECOVERY: the marker is written AFTER all scaling + cancellation
 * phases complete. If the script crashes mid-run (network blip, MongoDB
 * connection drop, unhandled exception), it will have applied *some* scaling
 * writes to the DB but NOT the marker. A naive re-run would double-scale
 * those rows. OPERATOR PROTOCOL ON ANY NON-ZERO EXIT:
 *   1. Do NOT re-run immediately.
 *   2. Restore the database from the pre-migration backup.
 *   3. Investigate the failure cause.
 *   4. Re-run the migration from scratch against the restored DB.
 * Always take a DB backup before running this script in production.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/corpEconomyToLocalCurrency.ts`
 */

import type { ObjectId } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { resolveCorpLiquidCurrencyCode } from "../../src/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "../../src/lib/constants/currencies";
import type { CurrencyCode } from "../../src/lib/constants/currencies";
import type { Corporation, CorporateSector } from "../../src/lib/db/types";

type ObjectIdLike = ObjectId;
type CountryCodeKey = keyof typeof COUNTRY_CURRENCY_MAP;

const MARKER_ID = "corp-economy-to-local-currency";

// NOTE: `liquidCapital` is intentionally NOT in this list. The snapshot writer
// (src/lib/turn/corporation/sectorCalculations.ts) already persists
// `CorporationHistory.liquidCapital` in the corp's home currency:
// `corp.liquidCapital (local) + anchorToCorpCapital(income, code, rate)`. Every
// historical row is therefore already local, so rescaling here would
// double-scale them.
const CORP_HISTORY_MONEY_FIELDS = [
  "sharePrice",
  "marketCap",
  "revenue",
  "income",
  "incomePreDividends",
  "totalCosts",
  "dividendPaidPerTurn",
  "corporateTaxPaid",
  "federalTaxPaid",
  "stateTaxPaid",
  "sectorNPV",
  "perTurnBondCouponIncome",
  "perTurnBondDragOnNetIncome",
];
// Record<string, number> tax-breakdown maps. Each value is an ₳-denominated
// amount pre-migration (post-v0.2.6 writes convert to corp currency at write
// time via convertMapToLocalRecord). Scale every value by the corp's rate.
const CORP_HISTORY_MAP_FIELDS = ["taxPaidByCountry", "taxPaidByState"];
// `corporationPortfolioHistory` is intentionally NOT migrated. It records a
// cross-currency aggregate (a holder corp may own stocks and bonds across 3+
// currencies in the same snapshot), so there is no meaningful single local
// currency for the row. `src/lib/turn/portfolioSnapshot.ts` writes every row in
// ₳ (bondValueAnchor / stockValueAnchor via corpLiquidCapitalToAnchor) pre- and
// post-v0.2.6; readers convert to wallet-preference at display time via
// `formatAmount(anchorValue)`. This matches the symmetric character-side
// `portfolioHistory` collection, which also stays in ₳.

async function main() {
  const db = await connectDb();
  try {
    const marker = await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .findOne({ _id: MARKER_ID });
    if (marker) {
      console.log(`[${MARKER_ID}] already ran at ${marker.completedAt}. Exiting.`);
      return;
    }

    // Pre-flight: warn if turn processing is still running. A turn fill mid-
    // migration would write new orders we'd miss in cancellation and could
    // double-scale corp money fields that we've already rescaled. This is a
    // soft check (we can't halt the cron from here) — the operator is
    // responsible for pausing via the admin panel.
    const gameState =
      (await db
        .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
        .findOne({ _id: "current" })) ?? null;
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. Turn processing may be running. ` +
          `This migration is not atomic; a concurrent turn fill could corrupt the scaled fields. ` +
          `Pause turns via the admin panel and re-run. Continuing in 10 seconds — abort with Ctrl-C ` +
          `if this is unexpected.`
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    // ── Load FX rates ────────────────────────────────────────────────────────
    const rates = new Map<string, number>();
    for (const r of await db.collection("exchangeRates").find({}).toArray()) {
      const code = r.currencyCode as string | undefined;
      const rate = Number(r.rate);
      if (code && Number.isFinite(rate) && rate > 0) rates.set(code, rate);
    }
    if (!rates.has("USD")) rates.set("USD", 1);

    const corps = await db.collection<Corporation>("corporations").find({}).toArray();

    // ── Phase 1: corp doc money fields ───────────────────────────────────────
    let corpUpdates = 0;
    let corpSkipped = 0;
    for (const corp of corps) {
      const code = resolveCorpLiquidCurrencyCode(corp);
      if (!code) {
        corpSkipped++;
        continue;
      }
      const rate = rates.get(code);
      if (!rate || rate <= 0) {
        console.warn(`  skip corp ${corp._id}: no rate for ${code}`);
        corpSkipped++;
        continue;
      }
      const set: Record<string, number> = {};
      if ((corp.marketingBudget ?? 0) > 0)
        set.marketingBudget = Math.round(corp.marketingBudget * rate * 100) / 100;
      if ((corp.logisticsBudget ?? 0) > 0)
        set.logisticsBudget = Math.round((corp.logisticsBudget ?? 0) * rate * 100) / 100;
      if ((corp.ceoSalary ?? 0) > 0)
        set.ceoSalary = Math.round((corp.ceoSalary ?? 0) * rate * 100) / 100;
      if ((corp.sharePrice ?? 0) > 0)
        set.sharePrice = Math.round(corp.sharePrice * rate * 100) / 100;
      if (Object.keys(set).length === 0) continue;
      await db.collection("corporations").updateOne({ _id: corp._id }, { $set: set });
      corpUpdates++;
    }

    // ── Phase 2: corporateSectors ────────────────────────────────────────────
    // Build per-corp FX lookup once to avoid re-resolving per sector. Also
    // cache the full corp doc (keyed by id-string) for the order-cancellation
    // phase so we can resolve placer corp currencies without a DB round-trip
    // per refund.
    const corpCurrencyById = new Map<string, { code: string; rate: number }>();
    const corpsById = new Map<string, Corporation>();
    for (const corp of corps) {
      corpsById.set(corp._id.toString(), corp);
      const code = resolveCorpLiquidCurrencyCode(corp);
      if (!code) continue;
      const rate = rates.get(code);
      if (rate && rate > 0) corpCurrencyById.set(corp._id.toString(), { code, rate });
    }

    const sectors = await db.collection<CorporateSector>("corporateSectors").find({}).toArray();
    let sectorUpdates = 0;
    for (const sector of sectors) {
      const info = corpCurrencyById.get(sector.corporationId.toString());
      if (!info) continue;
      const set: Record<string, number> = {};
      if ((sector.revenue ?? 0) > 0)
        set.revenue = Math.round(sector.revenue * info.rate * 100) / 100;
      if ((sector.currentGrowthCost ?? 0) > 0)
        set.currentGrowthCost = Math.round(sector.currentGrowthCost * info.rate * 100) / 100;
      if (Object.keys(set).length === 0) continue;
      await db.collection("corporateSectors").updateOne({ _id: sector._id }, { $set: set });
      sectorUpdates++;
    }

    // ── Phase 3: history collections (option 3 — backfill all) ───────────────
    // Aggregation pipeline update: for each scalar money field, multiply by
    // `rate` when the stored value is > 0; zero / missing values stay zero.
    //
    // NOTE: marketCapHistory is intentionally NOT rescaled. That collection
    // stores per-turn global aggregates (globalMarketCap, per-exchange caps,
    // bySector) which are summed in ₳ at write time by marketCapSnapshot.ts
    // and remain ₳ aggregates post-v0.2.6.
    function buildUpdateSet(fields: string[], rate: number) {
      const setDoc: Record<string, unknown> = {};
      for (const f of fields) {
        setDoc[f] = {
          $cond: {
            if: { $gt: [{ $ifNull: [`$${f}`, 0] }, 0] },
            then: { $multiply: [`$${f}`, rate] },
            else: { $ifNull: [`$${f}`, 0] },
          },
        };
      }
      return setDoc;
    }

    // Scale each value inside a Record<string, number> field by `rate`, leaving
    // the field absent when it's missing on the source doc. Uses MongoDB
    // aggregation primitives so we can batch-update without fetching each doc.
    function buildMapUpdateSet(fields: string[], rate: number) {
      const setDoc: Record<string, unknown> = {};
      for (const f of fields) {
        setDoc[f] = {
          $cond: {
            if: {
              $and: [{ $ne: [{ $type: `$${f}` }, "missing"] }, { $ne: [`$${f}`, null] }],
            },
            then: {
              $arrayToObject: {
                $map: {
                  input: { $objectToArray: `$${f}` },
                  as: "kv",
                  in: {
                    k: "$$kv.k",
                    v: {
                      $cond: {
                        if: { $gt: ["$$kv.v", 0] },
                        then: { $multiply: ["$$kv.v", rate] },
                        else: "$$kv.v",
                      },
                    },
                  },
                },
              },
            },
            else: "$$REMOVE",
          },
        };
      }
      return setDoc;
    }

    let historyUpdates = 0;
    for (const corp of corps) {
      const info = corpCurrencyById.get(corp._id.toString());
      if (!info) continue;
      const { rate } = info;

      const r1 = await db.collection("corporationHistory").updateMany({ corporationId: corp._id }, [
        {
          $set: {
            ...buildUpdateSet(CORP_HISTORY_MONEY_FIELDS, rate),
            ...buildMapUpdateSet(CORP_HISTORY_MAP_FIELDS, rate),
          },
        },
      ]);

      historyUpdates += r1.modifiedCount ?? 0;
    }

    // ── Also stamp corporationHistory.currencyCode (Task 10 field) ────────────
    // Every snapshot now explicitly carries the corp's currency at time of write.
    // corporationId is stored as ObjectId, so we must re-hydrate it here — the
    // earlier code queried by string which matched no docs.
    let historyStamps = 0;
    for (const corp of corps) {
      const info = corpCurrencyById.get(corp._id.toString());
      if (!info) continue;
      const result = await db
        .collection("corporationHistory")
        .updateMany(
          { corporationId: corp._id, currencyCode: { $exists: false } },
          { $set: { currencyCode: info.code } }
        );
      historyStamps += result.modifiedCount ?? 0;
    }

    // ── Cancel all open share orders / offers / listings, refund escrow ─────
    // Pre-v0.2.6, escrow + limit prices + marketPriceAtCreation were stored
    // in ₳. The v0.2.6 code (Option B) expects all of these in each target
    // corp's liquidCurrencyCode. Rather than rescale live orders across a
    // storage-unit change — which has subtle edge cases around partial-fill
    // residuals, avgCostPerShare weighted-average math, and the 50/200%
    // offer bounds — the safe cutover is: cancel every open order/offer
    // and listing, refund the escrow to the placer's wallet using the
    // pre-migration ₳ semantics, and let users re-place fresh orders
    // after the code deploys. Users lose no money; they lose only the
    // open-order state, which is trivially re-created.
    const cancellationsAt = new Date();
    let ordersCancelled = 0;
    let offersCancelled = 0;
    let listingsCancelled = 0;
    let charRefundsApplied = 0;
    let corpRefundsApplied = 0;

    // Build a (charId → { countryId, isImperial }) cache so we can refund
    // multiple orders/offers to the same character with one doc fetch each.
    const characterCurrencyCache = new Map<
      string,
      { countryId: string; collection: "characters" | "imperialCharacters" } | null
    >();
    async function resolveCharacterCurrency(
      charId: ObjectIdLike
    ): Promise<{ countryId: string; collection: "characters" | "imperialCharacters" } | null> {
      const key = charId.toString();
      const cached = characterCurrencyCache.get(key);
      if (cached !== undefined) return cached;
      const char = (await db
        .collection("characters")
        .findOne({ _id: charId }, { projection: { countryId: 1 } })) as {
        countryId?: string;
      } | null;
      if (char?.countryId) {
        const entry = { countryId: char.countryId, collection: "characters" as const };
        characterCurrencyCache.set(key, entry);
        return entry;
      }
      const imperial = (await db
        .collection("imperialCharacters")
        .findOne({ _id: charId }, { projection: { countryId: 1 } })) as {
        countryId?: string;
      } | null;
      if (imperial?.countryId) {
        const entry = {
          countryId: imperial.countryId,
          collection: "imperialCharacters" as const,
        };
        characterCurrencyCache.set(key, entry);
        return entry;
      }
      characterCurrencyCache.set(key, null);
      return null;
    }

    // Convert a ₳ amount into a character / imperial wallet credit in their
    // home currency. Orphaned characters (no countryId resolution) are
    // skipped — their escrow is effectively forfeit, but this matches the
    // retireCharacter.ts behavior for deleted accounts.
    //
    // Pre-forex legacy characters (no `currencyBalances` structure) get the
    // refund on `cashOnHand` instead so the credit lands in the bucket their
    // account actually reads from. Post-forex characters always have
    // currencyBalances.personal.<home>; the $inc creates it if missing.
    async function creditCharacterRefundFromAnchor(
      charId: ObjectIdLike,
      anchorAmount: number
    ): Promise<boolean> {
      if (anchorAmount <= 0) return false;
      const meta = await resolveCharacterCurrency(charId);
      if (!meta) return false;
      // Probe for currencyBalances presence on this character — determines
      // whether we write to the forex wallet or legacy cashOnHand.
      const wallet = (await db
        .collection(meta.collection)
        .findOne({ _id: charId }, { projection: { currencyBalances: 1 } })) as {
        currencyBalances?: unknown;
      } | null;
      const hasForexWallet = wallet?.currencyBalances != null;

      const currency = (COUNTRY_CURRENCY_MAP[meta.countryId as CountryCodeKey] ??
        "USD") as CurrencyCode;
      const fxRate = rates.get(currency) ?? 1.0;
      const amountInCurrency = anchorAmount * fxRate;
      const inc = hasForexWallet
        ? { [`currencyBalances.personal.${currency}`]: amountInCurrency }
        : { cashOnHand: anchorAmount }; // pre-forex wallets stay in ₳
      await db
        .collection(meta.collection)
        .updateOne({ _id: charId }, { $inc: inc, $set: { updatedAt: cancellationsAt } });
      return true;
    }

    async function creditCorpRefundFromAnchor(
      placerCorpId: ObjectIdLike,
      anchorAmount: number
    ): Promise<boolean> {
      if (anchorAmount <= 0) return false;
      const placer = corpsById.get(placerCorpId.toString());
      if (!placer) return false;
      const code = resolveCorpLiquidCurrencyCode(placer);
      const fxRate = code ? (rates.get(code) ?? 1.0) : 1.0;
      const refundLocal = anchorAmount * fxRate;
      await db
        .collection("corporations")
        .updateOne(
          { _id: placerCorpId },
          { $inc: { liquidCapital: refundLocal }, $set: { updatedAt: cancellationsAt } }
        );
      return true;
    }

    // Restore shares to a shareholder entry. If the entry no longer exists
    // (e.g., hostile takeover stripped it, character retired), fall back to
    // $push a fresh entry so the reservation isn't silently lost. Mirrors
    // the push-if-missing logic in creditShares / creditSharesToCorp.
    // Returns true if the shares landed somewhere, false if the target corp
    // itself is missing (truly orphaned order).
    type ShareTarget =
      | { kind: "character"; characterId: ObjectIdLike }
      | { kind: "corporation"; corporationId: ObjectIdLike };
    let sharesRestored = 0;
    let sharesOrphaned = 0;
    async function restoreSharesToHolder(
      targetCorpId: ObjectIdLike,
      holder: ShareTarget,
      shares: number
    ): Promise<void> {
      if (shares <= 0) return;
      // First try the positional $inc against an existing entry.
      const filter: Record<string, unknown> = { _id: targetCorpId };
      if (holder.kind === "character") {
        filter["shareholders.characterId"] = holder.characterId;
      } else {
        filter["shareholders.corporationId"] = holder.corporationId;
      }
      const incResult = await db.collection("corporations").updateOne(filter, {
        $inc: { "shareholders.$.shares": shares },
        $set: { updatedAt: cancellationsAt },
      });
      if (incResult.matchedCount > 0) {
        sharesRestored += shares;
        return;
      }
      // Entry missing — push a new one if the target corp still exists.
      const existsFilter: Record<string, unknown> = { _id: targetCorpId };
      const pushDoc: Record<string, unknown> =
        holder.kind === "character"
          ? { characterId: holder.characterId, shares }
          : { corporationId: holder.corporationId, shares };
      const pushResult = await db.collection("corporations").updateOne(existsFilter, {
        $push: { shareholders: pushDoc },
        $set: { updatedAt: cancellationsAt },
      } as never);
      if (pushResult.matchedCount > 0) {
        sharesRestored += shares;
      } else {
        // Target corp itself is gone — shares are lost with it.
        sharesOrphaned += shares;
      }
    }

    // Open share orders ────────────────────────────────────────────────────
    const openOrders = await db.collection("shareOrders").find({ status: "open" }).toArray();
    for (const order of openOrders) {
      const orderDoc = order as {
        _id: ObjectIdLike;
        type: "buy" | "sell";
        corporationId: ObjectIdLike;
        characterId: ObjectIdLike;
        placerCorporationId?: ObjectIdLike;
        escrowAmount?: number;
        sharesRemaining?: number;
      };
      if (orderDoc.type === "buy") {
        const escrow = Number(orderDoc.escrowAmount ?? 0);
        if (escrow > 0) {
          if (orderDoc.placerCorporationId) {
            if (await creditCorpRefundFromAnchor(orderDoc.placerCorporationId, escrow)) {
              corpRefundsApplied++;
            }
          } else if (await creditCharacterRefundFromAnchor(orderDoc.characterId, escrow)) {
            charRefundsApplied++;
          }
        }
      } else if (orderDoc.type === "sell" && orderDoc.placerCorporationId) {
        // Corp sell orders debited shares from the placer corp's shareholder
        // entry at creation time; restore them so the placer isn't short
        // after cancellation. Push-if-missing handles the case where the
        // placer corp got removed from shareholders between creation and
        // cutover (e.g., hostile takeover absorbing their stake).
        const remaining = Number(orderDoc.sharesRemaining ?? 0);
        if (remaining > 0) {
          await restoreSharesToHolder(
            orderDoc.corporationId,
            { kind: "corporation", corporationId: orderDoc.placerCorporationId },
            remaining
          );
        }
      }
      // Personal sell orders only reserved shares — no adjustment needed.

      await db
        .collection("shareOrders")
        .updateOne(
          { _id: orderDoc._id },
          { $set: { status: "cancelled", updatedAt: cancellationsAt } }
        );
      ordersCancelled++;
    }

    // Pending share offers ─────────────────────────────────────────────────
    const pendingOffers = await db.collection("shareOffers").find({ status: "pending" }).toArray();
    for (const offer of pendingOffers) {
      const offerDoc = offer as {
        _id: ObjectIdLike;
        buyerCharacterId: ObjectIdLike;
        buyerCorporationId?: ObjectIdLike;
        escrowAmount?: number;
      };
      const escrow = Number(offerDoc.escrowAmount ?? 0);
      if (escrow > 0) {
        if (offerDoc.buyerCorporationId) {
          if (await creditCorpRefundFromAnchor(offerDoc.buyerCorporationId, escrow)) {
            corpRefundsApplied++;
          }
        } else if (await creditCharacterRefundFromAnchor(offerDoc.buyerCharacterId, escrow)) {
          charRefundsApplied++;
        }
      }
      await db
        .collection("shareOffers")
        .updateOne(
          { _id: offerDoc._id },
          { $set: { status: "cancelled", updatedAt: cancellationsAt } }
        );
      offersCancelled++;
    }

    // Open share listings ──────────────────────────────────────────────────
    // Reserved shares were debited from the seller at listing creation.
    // Restore them to whichever entity listed (character or corp).
    const openListings = await db.collection("shareListings").find({ status: "open" }).toArray();
    for (const listing of openListings) {
      const listingDoc = listing as {
        _id: ObjectIdLike;
        corporationId: ObjectIdLike;
        sellerCharacterId: ObjectIdLike;
        sellerCorporationId?: ObjectIdLike;
        sharesRemaining?: number;
      };
      const remaining = Number(listingDoc.sharesRemaining ?? 0);
      if (remaining > 0) {
        if (listingDoc.sellerCorporationId) {
          await restoreSharesToHolder(
            listingDoc.corporationId,
            { kind: "corporation", corporationId: listingDoc.sellerCorporationId },
            remaining
          );
        } else {
          await restoreSharesToHolder(
            listingDoc.corporationId,
            { kind: "character", characterId: listingDoc.sellerCharacterId },
            remaining
          );
        }
      }
      await db
        .collection("shareListings")
        .updateOne(
          { _id: listingDoc._id },
          { $set: { status: "cancelled", updatedAt: cancellationsAt } }
        );
      listingsCancelled++;
    }

    // ── Shareholder avgCostPerShare migration (nested array) ─────────────────
    // Each corp's shareholders[] has an optional avgCostPerShare — the weighted
    // average price at which each shareholder acquired their stake. Pre-Task-18A
    // writes stored this in ₳; post-Task-18A writes store it in local. For the
    // blended-average math in `creditShares` to stay coherent after cutover,
    // every pre-existing avgCostPerShare on a corp whose FX rate isn't identity
    // must be rescaled by that rate. MongoDB's positional $[] operator with an
    // aggregation pipeline handles the in-place update across the nested array.
    let shareholderUpdates = 0;
    for (const corp of corps) {
      const info = corpCurrencyById.get(corp._id.toString());
      if (!info) continue;
      const { rate } = info;
      // Identity-scale skip: rescaling by 1 is a no-op write. This is NOT a
      // USD-specific guard — USD floats against ₳ and typically has rate ≠ 1
      // (e.g. 1.0416 at time of writing), so USD corps DO get rescaled. The
      // skip only fires for currencies whose live rate is exactly 1.
      if (rate === 1) continue;

      const result = await db.collection("corporations").updateOne({ _id: corp._id }, [
        {
          $set: {
            shareholders: {
              $map: {
                input: { $ifNull: ["$shareholders", []] },
                as: "sh",
                in: {
                  $cond: {
                    if: {
                      $and: [
                        { $ne: [{ $type: "$$sh.avgCostPerShare" }, "missing"] },
                        { $gt: [{ $ifNull: ["$$sh.avgCostPerShare", 0] }, 0] },
                      ],
                    },
                    then: {
                      $mergeObjects: [
                        "$$sh",
                        { avgCostPerShare: { $multiply: ["$$sh.avgCostPerShare", rate] } },
                      ],
                    },
                    else: "$$sh",
                  },
                },
              },
            },
          },
        },
      ]);
      shareholderUpdates += result.modifiedCount ?? 0;
    }

    // ── Record completion ────────────────────────────────────────────────────
    await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .insertOne({
        _id: MARKER_ID,
        completedAt: new Date(),
        corpUpdates,
        corpSkipped,
        sectorUpdates,
        historyUpdates,
        historyStamps,
        ordersCancelled,
        offersCancelled,
        listingsCancelled,
        charRefundsApplied,
        corpRefundsApplied,
        sharesRestored,
        sharesOrphaned,
        shareholderUpdates,
      });
    console.log(
      `[${MARKER_ID}] complete: ${corpUpdates} corps (${corpSkipped} skipped), ` +
        `${sectorUpdates} sectors, ${historyUpdates} history rows, ` +
        `${historyStamps} history stamps, ${ordersCancelled} orders cancelled, ` +
        `${offersCancelled} offers cancelled, ${listingsCancelled} listings cancelled, ` +
        `${charRefundsApplied} char refunds, ${corpRefundsApplied} corp refunds, ` +
        `${sharesRestored} shares restored to holders, ${sharesOrphaned} shares orphaned ` +
        `(target corp gone), ${shareholderUpdates} corps with shareholder avgCost rescaled.`
    );
    if (sharesOrphaned > 0) {
      console.warn(
        `  WARN: ${sharesOrphaned} reserved shares could not be restored because their ` +
          `target corporation no longer exists. These were already orphaned pre-migration ` +
          `— review shareOrders / shareListings with status="cancelled" post-run if this ` +
          `count is surprising.`
      );
    }
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
