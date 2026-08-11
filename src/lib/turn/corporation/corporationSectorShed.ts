import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, UnownedSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  bucketKey,
  computeStateControlledBuckets,
} from "@/lib/nationalization/stateControlledBuckets";
import type { CorporationType } from "@/lib/constants/corporations";
import { revenuePerCapacityUnitForStrategy } from "@/lib/constants/capacityEconomy";
import {
  unownedHeadroomUnitsPerAnchor,
  unownedPoolCreditBaseExpr,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import type { CorporationLookups } from "./types";

// PLANTS-GATED: under plants the shed moves `capitalStock` units into the
// unowned pool's `headroomUnits`; the revenue writes below run only below the
// plants tier. Corp units and pool units are converted through the ₳ nameplate
// because each is priced at its own mix.
export interface SectorShedResult {
  corporateSectorsUpdated: number;
  unownedSectorsUpdated: number;
  totalRevenueShed: number;
  /**
   * Capacity units shed to the unowned headroom pool. Always 0 below the
   * plants tier, where the shed moves ₳ revenue instead.
   */
  totalCapacityUnitsShed?: number;
}

/**
 * Sheds `rate` of each sector's revenue + workers from the given corps to the
 * unowned-sector pool. Mutates `lookups.sectorsByCorp` entries in place so any
 * downstream turn-step in the same pipeline sees the reduced values.
 *
 * Caller is responsible for filtering `sheddingCorps` to the right candidate set.
 * `reasonLabel` is included in the diagnostic log (e.g. "Vacant CEO" or "Inactive CEO").
 *
 * ─── UNDER PLANTS THIS SHEDS CAPACITY, NOT REVENUE ──────────────────────────
 * At `marketSystemMode >= "plants"` the turn processor restates
 * `sector.revenue` from `capitalStock × mixPrice` every turn. The legacy shed
 * was therefore doubly wrong there: the `$inc` on the corp's revenue was undone
 * on the next tick (so the corp KEPT its capacity), while the unowned pool was
 * credited anyway — capacity conserved on one side and created on the other,
 * i.e. a per-turn market-share mint. Under plants the shed instead removes
 * `rate × capitalStock` units of plant from the corp and credits the same
 * quantity of demand-side headroom to the pool, and never touches revenue.
 */
export async function shedSectorsForCorps(
  db: Db,
  lookups: CorporationLookups,
  sheddingCorps: Corporation[],
  rate: number,
  now: Date,
  reasonLabel: string,
  /** `marketSystemMode >= "plants"`. Defaults false — legacy revenue shed. */
  plantsEnabled: boolean = false
): Promise<SectorShedResult> {
  if (sheddingCorps.length === 0) {
    return {
      corporateSectorsUpdated: 0,
      unownedSectorsUpdated: 0,
      totalRevenueShed: 0,
      totalCapacityUnitsShed: 0,
    };
  }

  for (const c of sheddingCorps) {
    console.log(
      `[Turn] ${reasonLabel} shed: corp ${c.name ?? c._id} — ceoId=${c.ceoId ?? "null"}, ceoVacant=${c.ceoVacant}, isNationalized=${c.isNationalized}, countryOwnerId=${c.countryOwnerId ?? "null"}`
    );
  }

  const sheddingIds = new Set(sheddingCorps.map((c) => c._id.toString()));

  // Don't re-seed unowned market in a sector the state has nationalized — a private
  // holder that shed capacity there would otherwise spawn an unowned pool that
  // re-fragments the state monopoly (the shed still shrinks the corp; the freed
  // capacity simply isn't released back to the market in a nationalized bucket).
  const nationalCorpIds = new Set(
    lookups.corporations.filter((c) => c.countryOwnerId != null).map((c) => c._id.toString())
  );
  const stateControlled = computeStateControlledBuckets(
    [...lookups.sectorsByCorp.values()].flat(),
    nationalCorpIds
  );

  const unownedDeltas = new Map<
    string,
    {
      stateId: string;
      sectorType: string;
      countryId: CountryId;
      revenue: number;
      /** Capacity units freed to the pool (plants only; 0 otherwise). */
      units: number;
    }
  >();

  const sectorOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: {
        $inc: { revenue?: number; workers: number; capitalStock?: number };
        $set: { updatedAt: Date; capacityBookAnchor?: number };
      };
    };
  }[] = [];

  let totalRevenueShed = 0;
  let totalCapacityUnitsShed = 0;

  for (const cid of sheddingIds) {
    for (const s of lookups.sectorsByCorp.get(cid) ?? []) {
      const rev = Math.max(0, s.revenue ?? 0);
      const workers = Math.max(0, s.workers ?? 0);
      let shedRev = Math.round(rev * rate);
      let shedWorkers = Math.round(workers * rate);
      shedRev = Math.min(shedRev, rev);
      shedWorkers = Math.min(shedWorkers, workers);

      if (plantsEnabled) {
        // FLIP TURN: the capacity shed is DEFERRED one turn.
        //
        // This runs before `processSectors`, and it is `sectorTurn` that
        // performs the lazy per-sector flip migration — until it has run,
        // `plantsStartTurn` is null and `capitalStock` does not yet mean what
        // this function assumes. Shedding here on that turn is unsound in both
        // directions:
        //
        //  - `capitalStock` absent (never ran under capital mode): stock reads 0,
        //    so the shed silently removed nothing while still shedding workers.
        //  - `capitalStock` present: the units WERE credited to the unowned pool
        //    and decremented on the corp, but `sectorTurn`'s flip adoption then
        //    takes `max(storedCapacity, seedCapitalStock(nameplate))` off a
        //    `revenue` this branch deliberately never touches — which is the
        //    PRE-shed level — and restores the capacity, overwriting the `$inc`
        //    in the same turn. Capacity conserved on the corp and created in the
        //    pool: a one-off market-share MINT on every vacant/inactive-CEO
        //    sector in the world, on the turn plants is switched on.
        //
        // Deferring costs one turn of attrition and leaves the world conserved.
        // The next turn `plantsStartTurn` is stamped, `capitalStock` is
        // authoritative, and the shed proceeds normally. Workers still shed on
        // the flip turn, exactly as they did when `capitalStock` was absent.
        const plantsCapacityEstablished = s.plantsStartTurn != null;
        // Capacity is the quantity; revenue is derived and must not be touched.
        const stock =
          typeof s.capitalStock === "number" && Number.isFinite(s.capitalStock)
            ? Math.max(0, s.capitalStock)
            : 0;
        // Round ONCE, here, and use the same number for the in-memory mutation,
        // the pool credit and the persisted `$inc`. The three used to disagree:
        // the mutation and the credit took the unrounded figure while the `$inc`
        // rounded to 2dp, so `processSectors` later in this same turn derived
        // revenue from a `capitalStock` that differed from what was written, and
        // the gap compounded turn over turn.
        //
        // On the flip turn this is ZERO rather than a skipped iteration: `stock`
        // keeps the doc's real value, so the in-memory mutation and the `$inc`
        // below are both no-ops on capacity (they must not write 0 over a real
        // stock), while the WORKER shed still runs.
        const shedUnits = plantsCapacityEstablished
          ? Math.round(Math.min(stock, stock * rate) * 100) / 100
          : 0;
        if (shedUnits <= 0 && shedWorkers <= 0) continue;

        totalCapacityUnitsShed += shedUnits;
        // P5: the paid basis leaves with the plant, pro-rata. Written as an
        // absolute `$set` rather than an `$inc` on purpose — a row that has no
        // recorded basis yet must keep taking the list-price FALLBACK, and an
        // `$inc` would materialise the field at a negative number and book the
        // whole sector at zero. Only a sector that already carries a basis is
        // touched; the rest are corrected by `sectorTurn` on the same turn.
        const remainingFraction = stock > 0 ? Math.max(0, stock - shedUnits) / stock : 1;
        const priorBook =
          typeof s.capacityBookAnchor === "number" &&
          Number.isFinite(s.capacityBookAnchor) &&
          s.capacityBookAnchor >= 0
            ? s.capacityBookAnchor
            : null;
        const nextBook = priorBook != null ? priorBook * remainingFraction : null;

        s.capitalStock = stock - shedUnits;
        s.workers = workers - shedWorkers;
        if (nextBook != null) s.capacityBookAnchor = nextBook;
        s.updatedAt = now;

        sectorOps.push({
          updateOne: {
            filter: { _id: s._id },
            update: {
              $inc: {
                capitalStock: -shedUnits,
                workers: -shedWorkers,
              },
              $set: {
                updatedAt: now,
                ...(nextBook != null ? { capacityBookAnchor: nextBook } : {}),
              },
            },
          },
        });

        if (shedUnits > 0 && !stateControlled.has(bucketKey(s.stateId, s.sectorType))) {
          // Corp units and pool units are BOTH "output units/day", but each is
          // priced by its own mix: the corp's at its live `strategyId`, the pool
          // at the sector type's default mix (unowned docs carry no strategy).
          // Route through the ₳ nameplate so the two are commensurable — the
          // same round trip `impliedOutputUnits` performs, and currency-free on
          // both legs (RPU and the base prices are ₳-native, so no FX enters).
          const nameplateAnchor =
            shedUnits *
            revenuePerCapacityUnitForStrategy(
              s.sectorType as CorporationType,
              s.strategyId,
              lookups.eraUnitScale
            );
          const poolUnits =
            nameplateAnchor *
            unownedHeadroomUnitsPerAnchor(s.sectorType as CorporationType, lookups.eraUnitScale);
          const key = `${s.stateId}\0${s.sectorType}`;
          const countryId = (s.countryId ?? "US") as CountryId;
          const prev = unownedDeltas.get(key);
          if (prev) prev.units += poolUnits;
          else
            unownedDeltas.set(key, {
              stateId: s.stateId,
              sectorType: s.sectorType,
              countryId,
              revenue: 0,
              units: poolUnits,
            });
        }
        continue;
      }

      if (shedRev <= 0 && shedWorkers <= 0) continue;

      totalRevenueShed += shedRev;
      s.revenue = rev - shedRev;
      s.workers = workers - shedWorkers;
      s.updatedAt = now;

      sectorOps.push({
        updateOne: {
          filter: { _id: s._id },
          update: {
            $inc: { revenue: -shedRev, workers: -shedWorkers },
            $set: { updatedAt: now },
          },
        },
      });

      if (shedRev > 0 && !stateControlled.has(bucketKey(s.stateId, s.sectorType))) {
        // shedRev is in the sector's host-state currency; convert to the
        // ₳-native unowned pool at the host rate, not the owning corp's.
        const shedRevAnchor = readCorpEconomicAnchor(
          shedRev,
          resolveSectorHostCurrencyCode(s, null),
          fxRateForSectorHostFromMap(s, null, lookups.exchangeRatesByCurrency)
        );
        const key = `${s.stateId}\0${s.sectorType}`;
        const countryId = (s.countryId ?? "US") as CountryId;
        const prev = unownedDeltas.get(key);
        if (prev) prev.revenue += shedRevAnchor;
        else
          unownedDeltas.set(key, {
            stateId: s.stateId,
            sectorType: s.sectorType,
            countryId,
            revenue: shedRevAnchor,
            units: 0,
          });
      }
    }
  }

  if (sectorOps.length === 0) {
    return {
      corporateSectorsUpdated: 0,
      unownedSectorsUpdated: 0,
      totalRevenueShed: 0,
      totalCapacityUnitsShed: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection("corporateSectors").bulkWrite(sectorOps as any[]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unownedOps: any[] = [];

  for (const { stateId, sectorType, countryId, revenue, units } of unownedDeltas.values()) {
    if (plantsEnabled) {
      // Units are AUTHORITATIVE on the pool under plants, and `revenue` is the
      // derived display/legacy-reader value — the mirror image of the owned
      // side, where `capitalStock` is authoritative and revenue is restated
      // from it. Written as an update PIPELINE (not `$inc`) for the same
      // self-healing reason `restoreSectorsToUnowned` uses one: a doc that
      // predates the `headroomUnits` backfill has no base to increment, so the
      // base is derived from its revenue first, then the shed is added, then
      // revenue is re-derived from the new total. Nothing accumulates from a
      // missing field, and the two fields cannot drift.
      unownedOps.push({
        updateOne: {
          filter: { stateId, sectorType },
          update: [
            {
              $set: {
                stateId: { $ifNull: ["$stateId", stateId] },
                countryId: { $ifNull: ["$countryId", countryId] },
                sectorType: { $ifNull: ["$sectorType", sectorType] },
                createdAt: { $ifNull: ["$createdAt", now] },
                updatedAt: now,
                headroomUnits: {
                  $add: [
                    unownedPoolCreditBaseExpr(
                      sectorType as CorporationType,
                      true,
                      lookups.eraUnitScale
                    ),
                    units,
                  ],
                },
              },
            },
            {
              $set: unownedPoolTrailingSet(
                sectorType as CorporationType,
                true,
                lookups.eraUnitScale
              ),
            },
          ],
          upsert: true,
        },
      });
      continue;
    }

    unownedOps.push({
      updateOne: {
        filter: { stateId, sectorType },
        update: {
          $inc: { revenue },
          $set: { updatedAt: now },
          $setOnInsert: {
            _id: new ObjectId(),
            stateId,
            countryId,
            sectorType: sectorType as UnownedSector["sectorType"],
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (unownedOps.length > 0) {
    await db.collection("unownedSectors").bulkWrite(unownedOps);
  }

  return {
    corporateSectorsUpdated: sectorOps.length,
    unownedSectorsUpdated: unownedOps.length,
    totalRevenueShed,
    totalCapacityUnitsShed,
  };
}
