import type { Db, Filter } from "mongodb";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { capacityPricePerUnit } from "@/lib/constants/capacityEconomy";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * ⚠️⚠️ DO NOT RUN THIS WITHOUT A PRODUCT DECISION. IT IS NOT READY. ⚠️⚠️
 *
 * The live dry run (turn 697, `scripts/debug/sv-09-dryrun-reprice.mjs`) shows a
 * blast radius far wider than the rare-earth exploit that motivated it:
 *
 *   - 2,390 sectors run a non-default strategy and are in scope.
 *   - Of the 210 the probe could price (extraction only), cuts ran from -25% to
 *     -99.96%, hitting coal, iron, oil and timber — not just rare earth.
 *   - The remaining ~2,145 are non-extraction strategies this migration WOULD
 *     also re-price.
 *
 * That is roughly half the world's productive capacity. The reason is that
 * almost every FOCUSED strategy concentrates output into a higher-value
 * commodity than its sector's diversified default, so almost all of them look
 * "underpriced" against the default mix. Measured across all 80 priced
 * (type, strategy) pairs: 27 cost more than the default, 28 cost LESS, 25 are
 * within 5%. Only two are extreme —
 *
 *     extraction/rare_earth_mining  326.9x     <- the actual exploit
 *     defense/heavy_armor            23.6x     <- probably also a defect
 *     extraction/timber_logging       7.0x
 *     ...everything else is between 0.80x and 3.0x...
 *
 * Two problems follow, and both need a human answer:
 *
 *   1. SCOPE. A 1.18x edge for `energy/renewables` is plausibly the intended
 *      reward for specialising; a 326.9x edge for rare earth plainly is not.
 *      This migration cannot tell them apart and treats both as theft.
 *   2. ASYMMETRY. The `min` guard means capacity is only ever written DOWN, so
 *      the 28 strategies that OVERPAID against the default keep nothing back.
 *      Applied as-is it is one-sided against exactly half the board.
 *
 * The forward pricing fix is unaffected by all of this and is safe: it only
 * governs what NEW capacity costs. This migration is about capacity already
 * standing, and should probably be narrowed to an explicit list of defective
 * (type, strategy) pairs rather than "every non-default strategy".
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Re-price capacity that was bought at the sector-type default price and then
 * pointed at a higher-RPU production method.
 *
 * `capacityPricePerUnit` used to resolve RPU from the sector TYPE's default
 * ("standard") mix while revenue resolved it from the sector's ACTUAL strategy.
 * For `extraction` that is a 326.9x gap, so capacity bought at the diversified
 * price and run as `rare_earth_mining` repaid its capex in 0.22 turns instead
 * of the intended 72. The pricing defect is fixed forward; this migration
 * settles the capacity already standing.
 *
 * ─── WHAT IT DOES (variant A: re-price) ─────────────────────────────────────
 * `capacityBookAnchor` is the sector's PAID BASIS — the cash actually spent on
 * the capacity it holds (see `sectorProfitBasis.sectorCapacityBookAnchor`). So
 * the honest amount of capacity that money buys is:
 *
 *     unitsCorrect = capacityBookAnchor / capacityPricePerUnit(type, year, scale, strategy)
 *
 * The corp keeps every currency unit of value it actually paid for; it loses
 * only capacity it never paid for. Nothing it paid for is destroyed, so
 * `refundAnchor` is 0 and `capacityBookAnchor` is left untouched.
 *
 * ⚠️ THE COMPENSATION VARIANT IS A PRODUCT DECISION AND IS NOT SETTLED.
 * Two alternatives were specified alongside this one and each is a one-line
 * change to {@link computeRepricedStock}:
 *   - B (rescission): `unitsCorrect = 0`, `refundAnchor = capacityBookAnchor`.
 *     Feels generous but hands a large liquid balance back into the economy.
 *   - C (re-price + sunk-cost goodwill): variant A plus a credit for operating
 *     spend sized to the phantom capacity. No clean identity behind the
 *     attribution.
 * Confirm the choice before running this for real. See the ADR
 * `ahd-capacity-strategy-pricing-adr-strategy-aware-build-price`.
 *
 * ─── SAFETY ─────────────────────────────────────────────────────────────────
 * - Capacity is NEVER written UP. `min` is used, so a sector that OVERPAID (a
 *   dominance premium, a foreign host) keeps the stock it has. This migration
 *   removes capacity that was never paid for; it does not hand any out.
 * - A row with no recorded `capacityBookAnchor` is SKIPPED. Its basis would
 *   have to come from the list-price fallback, which is derived from
 *   `capitalStock` itself, so re-pricing off it is circular and would silently
 *   confirm whatever stock the row happens to carry.
 * - Idempotent: a second run recomputes the same `min` and finds nothing to do.
 */

export interface RepricedStock {
  /** Capacity the recorded paid basis honestly buys, in output units/day. */
  unitsCorrect: number;
  /** Capacity being removed (never negative). */
  unitsRemoved: number;
  /** Cash returned to the corp. Always 0 under variant A. */
  refundAnchor: number;
  /** Set when the row was deliberately left alone. */
  skipped?: "no-recorded-basis" | "unpriceable" | "no-stock";
}

export function computeRepricedStock(input: {
  sectorType: CorporationType;
  strategyId: string | null;
  capitalStock: number | null | undefined;
  capacityBookAnchor: number | null | undefined;
  year: number;
  eraUnitScale: number;
}): RepricedStock {
  const stock =
    typeof input.capitalStock === "number" && Number.isFinite(input.capitalStock)
      ? Math.max(0, input.capitalStock)
      : 0;
  const none = (skipped: RepricedStock["skipped"]): RepricedStock => ({
    unitsCorrect: stock,
    unitsRemoved: 0,
    refundAnchor: 0,
    skipped,
  });

  if (stock <= 0) return none("no-stock");
  const book = input.capacityBookAnchor;
  if (typeof book !== "number" || !Number.isFinite(book) || book < 0) {
    return none("no-recorded-basis");
  }

  const unitPrice = capacityPricePerUnit(
    input.sectorType,
    input.year,
    input.eraUnitScale,
    input.strategyId
  );
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return none("unpriceable");

  // `min` so capacity is only ever written DOWN.
  const unitsCorrect = Math.min(stock, book / unitPrice);
  return {
    unitsCorrect,
    unitsRemoved: stock - unitsCorrect,
    // Variant A. See the header before changing this.
    refundAnchor: 0,
  };
}

/** Rows whose stock moves by less than this fraction are treated as unchanged. */
const MATERIAL_CHANGE_FRACTION = 1e-6;

async function repriceStrategyCapacity(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const gameState = await db
    .collection<{ _id: string; currentYear?: number; activePreset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1, activePreset: 1 } });
  const year = gameState?.currentYear;
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return { documentsScanned: 0, notes: ["no currentYear on gameState; refusing to re-price"] };
  }
  const eraUnitScale = getEraUnitScale(gameState?.activePreset);

  // Only sectors running a NON-default strategy can have been mispriced: the
  // default-strategy price is unchanged by the fix, so those rows are already
  // correct by construction.
  // `$nin` over a nullable optional field does not narrow against the driver's
  // Filter type, so the predicate is expressed as a plain document.
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ strategyId: { $nin: [null, "standard"] } } as Filter<CorporateSector>)
    .toArray();

  const corpNames = new Map<string, string>();
  if (sectors.length > 0) {
    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: [...new Set(sectors.map((s) => s.corporationId))] } },
        { projection: { name: 1, sequentialId: 1 } }
      )
      .toArray();
    for (const c of corps) corpNames.set(String(c._id), `${c.sequentialId} ${c.name}`);
  }

  const notes: string[] = [];
  const ops: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  let updated = 0;
  let unitsRemovedTotal = 0;

  for (const sector of sectors) {
    const result = computeRepricedStock({
      sectorType: sector.sectorType,
      strategyId: sector.strategyId ?? null,
      capitalStock: sector.capitalStock,
      capacityBookAnchor: sector.capacityBookAnchor,
      year,
      eraUnitScale,
    });
    if (result.skipped) {
      if (result.skipped === "no-recorded-basis") {
        notes.push(
          `SKIP ${corpNames.get(String(sector.corporationId)) ?? sector.corporationId} ${sector.sectorType}/${sector.stateId} ${sector.strategyId}: no recorded basis`
        );
      }
      continue;
    }
    const stock = sector.capitalStock ?? 0;
    if (result.unitsRemoved <= stock * MATERIAL_CHANGE_FRACTION) continue;

    updated++;
    unitsRemovedTotal += result.unitsRemoved;
    notes.push(
      `${corpNames.get(String(sector.corporationId)) ?? sector.corporationId} ` +
        `${sector.sectorType}/${sector.stateId} ${sector.strategyId}: ` +
        `stock ${stock.toFixed(0)} -> ${result.unitsCorrect.toFixed(2)} ` +
        `(-${((result.unitsRemoved / stock) * 100).toFixed(2)}%), ` +
        `basis ${(sector.capacityBookAnchor ?? 0).toFixed(0)} unchanged`
    );
    ops.push({
      updateOne: {
        filter: { _id: sector._id },
        // `capacityBookAnchor` is deliberately NOT touched: the cash paid did
        // not change, only how much capacity that cash honestly buys. Revenue
        // and workers are both derived downstream and re-settle on the next
        // sector turn, so neither is written here.
        update: { $set: { capitalStock: result.unitsCorrect } },
      },
    });
  }

  if (!ctx.dryRun && ops.length > 0) {
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);
  }

  notes.unshift(
    `${ctx.dryRun ? "DRY RUN — no writes. " : ""}year ${year}, eraUnitScale ${eraUnitScale}, ` +
      `${sectors.length} non-default-strategy sectors scanned, ${updated} re-priced, ` +
      `${unitsRemovedTotal.toFixed(0)} capacity units removed`
  );

  return {
    documentsScanned: sectors.length,
    documentsUpdated: ctx.dryRun ? 0 : ops.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-07-reprice-strategy-capacity",
  description:
    "Re-price capacity bought at the sector-type default price and run on a higher-RPU strategy",
  idempotent: true,
  execute: repriceStrategyCapacity,
};
