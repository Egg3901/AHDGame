/**
 * One-time migration: re-denominate every CorporateSector economic money field
 * from the OWNING CORP's `liquidCurrencyCode` to the sector's HOST-STATE
 * functional currency (the currency of the country where the sector operates).
 *
 * Rewrites (same ₳ value, different currency of denomination):
 *   - `corporateSectors.{revenue, realizedRevenue, currentGrowthCost, laborCost}`
 *
 * WHY: before this change a sector's revenue rode its owner's currency, so a
 * foreign-owned sector's real (₳) value moved with the parent's FX rate instead
 * of the market it operates in. The turn/aggregation/transfer code now stores
 * and reads these fields in the sector's host currency; this migration brings
 * existing rows into line.
 *
 * Rescale math (per field, > 0 only): the stored value is in the owning corp's
 * currency `C_corp` at rate `r_corp` (local per ₳); the same ₳ amount in the
 * host currency `C_host` at rate `r_host` is:
 *
 *     new = old / r_corp * r_host = old * (r_host / r_corp)
 *
 * For a DOMESTIC sector `C_host === C_corp` so the factor is 1 and the row is
 * skipped — that is every sector in a single-country world, making this a no-op
 * until players own foreign sectors. Only cross-border-owned sectors move.
 *
 * The host currency is DERIVED from `sector.countryId` (immutable per sector) via
 * COUNTRY_CURRENCY_MAP — no new stored field. `resolveSectorHostCurrencyCode`
 * (the same helper the runtime uses) falls back to the corp's country when a
 * sector somehow lacks a countryId.
 *
 * Idempotent via `migrationsRun` marker (_id = "sector-to-host-currency"), written
 * LAST. CRASH RECOVERY — on ANY non-zero exit, do NOT re-run: some rows may be
 * rescaled but the marker unwritten, so a re-run would double-scale. Restore from
 * the pre-migration backup, investigate, then re-run against the restored DB.
 * Always take a backup before running in production.
 *
 * Usage: `MONGODB_URI=...&directConnection=true npx tsx scripts/migrations/sectorToHostCurrency.ts`
 */

import { connectDb, closeDb } from "../utils/db";
import {
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "../../src/lib/currency/corporationCapital";
import type { Corporation, CorporateSector } from "../../src/lib/db/types";

const MARKER_ID = "sector-to-host-currency";

// Sector economic fields stored in a currency (all move from corp -> host).
const SECTOR_MONEY_FIELDS: Array<keyof CorporateSector> = [
  "revenue",
  "realizedRevenue",
  "currentGrowthCost",
  "laborCost",
];

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

    // Pre-flight: this migration is not atomic. A concurrent turn fill could
    // rewrite a sector's revenue mid-migration and get double-scaled. Soft check
    // only — the operator must pause turns via the admin panel.
    const gameState =
      (await db
        .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
        .findOne({ _id: "current" })) ?? null;
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. Turn processing may be running. ` +
          `Pause turns via the admin panel and re-run. Continuing in 10 seconds — abort with ` +
          `Ctrl-C if this is unexpected.`
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    // ── Load FX rates (local per ₳) ──────────────────────────────────────────
    const rates = new Map<string, number>();
    for (const r of await db.collection("exchangeRates").find({}).toArray()) {
      const code = r.currencyCode as string | undefined;
      const rate = Number(r.rate);
      if (code && Number.isFinite(rate) && rate > 0) rates.set(code, rate);
    }
    if (!rates.has("USD")) rates.set("USD", 1);

    // ── Per-corp home currency lookup ────────────────────────────────────────
    const corps = await db.collection<Corporation>("corporations").find({}).toArray();
    const corpsById = new Map<string, Corporation>();
    for (const corp of corps) corpsById.set(corp._id.toString(), corp);

    // ── Rescale each sector's money fields corp-ccy -> host-ccy ───────────────
    const sectors = await db.collection<CorporateSector>("corporateSectors").find({}).toArray();
    let updated = 0;
    let domesticSkipped = 0;
    let missingRateSkipped = 0;
    const byPair: Record<string, number> = {};

    for (const sector of sectors) {
      const corp = corpsById.get(sector.corporationId?.toString());
      const corpCode = resolveCorpLiquidCurrencyCode(corp);
      const hostCode = resolveSectorHostCurrencyCode(sector, corp);

      // Same currency (domestic, or unresolvable both ways) → no rescale needed.
      if (!corpCode || !hostCode || corpCode === hostCode) {
        domesticSkipped++;
        continue;
      }

      const rCorp = rates.get(corpCode);
      const rHost = rates.get(hostCode);
      if (!rCorp || rCorp <= 0 || !rHost || rHost <= 0) {
        console.warn(
          `  skip sector ${sector._id}: missing rate (corp ${corpCode}=${rCorp}, host ${hostCode}=${rHost})`
        );
        missingRateSkipped++;
        continue;
      }

      const factor = rHost / rCorp;
      const set: Record<string, number> = {};
      for (const field of SECTOR_MONEY_FIELDS) {
        const value = sector[field] as number | undefined;
        if (typeof value === "number" && value > 0) {
          set[field] = Math.round(value * factor * 100) / 100;
        }
      }
      if (Object.keys(set).length === 0) {
        domesticSkipped++;
        continue;
      }

      await db.collection("corporateSectors").updateOne({ _id: sector._id }, { $set: set });
      updated++;
      const key = `${corpCode}->${hostCode}`;
      byPair[key] = (byPair[key] ?? 0) + 1;
    }

    // ── Record completion (LAST) ─────────────────────────────────────────────
    await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .insertOne({
        _id: MARKER_ID,
        completedAt: new Date(),
        totalSectors: sectors.length,
        updated,
        domesticSkipped,
        missingRateSkipped,
        byPair,
      });
    console.log(
      `[${MARKER_ID}] complete: ${updated} cross-border sectors re-denominated to host currency, ` +
        `${domesticSkipped} domestic/no-op skipped, ${missingRateSkipped} skipped for missing rates ` +
        `(of ${sectors.length} total). Pairs: ${JSON.stringify(byPair)}.`
    );
    if (missingRateSkipped > 0) {
      console.warn(
        `  WARN: ${missingRateSkipped} sectors were left in their old (corp) currency because a ` +
          `required FX rate was missing. Review and re-run once rates exist; those rows are ` +
          `unchanged, so a re-run is safe for them specifically (but the marker is now set — ` +
          `clear it first if you must reprocess).`
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
