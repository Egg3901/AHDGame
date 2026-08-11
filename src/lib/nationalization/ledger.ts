import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { NationalizationLedgerEntry } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadFxRatesByCurrency, anchorToCorpCapital } from "@/lib/currency/corporationCapital";
import { recordAudit } from "@/lib/audit/recordAudit";

const COLLECTION = "nationalizationLedger";

/**
 * Append a nationalization audit row (spec §10/§12 — the acquisition + political
 * cost ledger surfaced on the National Corporation page's Register tab). Additive
 * and best-effort: callers wrap this in try/catch so a failed ledger write never
 * aborts the taking it records.
 *
 * Central seam for nationalize/privatize actions (executive taking, legislative
 * provisions, IPO/auction spin-outs) — every call site (privatizeAsset,
 * nationalizeSectorWide, ownershipTransition, privatizationAuction) shares this
 * one write, so one audit envelope here covers all of them (§P4 breadth).
 */
export async function recordNationalizationLedger(
  db: Db,
  entry: Omit<NationalizationLedgerEntry, "_id" | "createdAt">
): Promise<void> {
  const doc: NationalizationLedgerEntry = {
    ...entry,
    _id: new ObjectId(),
    createdAt: new Date(),
  };
  await db.collection<NationalizationLedgerEntry>(COLLECTION).insertOne(doc);

  recordAudit({
    source: "api",
    action: doc.kind.startsWith("nationalize")
      ? "nationalization.execute"
      : "privatization.execute",
    category: "corp",
    turn: doc.turn,
    ts: doc.createdAt,
    subject: {
      type: "corporation",
      id: doc.nationalCorporationId,
      name: doc.newCorpName ?? doc.formerCorpName,
    },
    amount: doc.compensationAnchor || doc.valuationAnchor || undefined,
    refs: { corporationId: doc.nationalCorporationId },
    outcome: "ok",
    meta: {
      kind: doc.kind,
      method: doc.method,
      tier: doc.tier,
      triggers: doc.triggers,
      sectorTypes: doc.sectorTypes,
      countryId: doc.countryId,
      foreignOwnerCountryId: doc.foreignOwnerCountryId,
      legitimacyDelta: doc.legitimacyDelta,
    },
  });
}

/**
 * The compensation the treasury ACTUALLY paid for a taking, in `currency`,
 * summed from the permanent ledger and converted from ₳. Matches a sector taking
 * by (countryId, sectorType) or a whole-corp taking by (countryId, formerCorpName).
 * Returns `undefined` when no taking has been recorded yet (proposed/pending
 * bills), so the caller can fall back to the estimate. Unlike the estimate, the
 * ledger never zeroes out after the assets are taken — it is the authoritative
 * figure for an enacted bill, past or future, immediate or deferred.
 */
export async function resolveActualPayoutLocal(
  db: Db,
  params: {
    countryId: CountryId;
    currency: CurrencyCode;
    sectorType?: CorporationType;
    corpName?: string;
  }
): Promise<number | undefined> {
  const filter: Record<string, unknown> = { countryId: params.countryId };
  if (params.sectorType) {
    filter.kind = "nationalize_sector";
    filter.sectorTypes = params.sectorType; // array-contains match
  } else if (params.corpName) {
    filter.kind = "nationalize_whole";
    filter.formerCorpName = params.corpName;
  } else {
    return undefined;
  }
  const rows = await db.collection<NationalizationLedgerEntry>(COLLECTION).find(filter).toArray();
  if (rows.length === 0) return undefined;
  const totalAnchor = rows.reduce((sum, r) => sum + (r.compensationAnchor ?? 0), 0);
  const fx = await loadFxRatesByCurrency(db);
  const rate = fx.get(params.currency) ?? 1;
  return Math.round(anchorToCorpCapital(totalAnchor, params.currency, rate));
}

/**
 * A National Corporation's own *acquisition* rows (nationalizations only),
 * newest first. Privatization rows share the collection (keyed by the source
 * NatCorp) but are excluded here — this read backs the Holdings "how acquired"
 * grouping, which must not count divestitures. The country-wide register uses
 * {@link getCountryNationalizationLedger}, which includes both.
 */
export async function getNationalizationLedger(
  db: Db,
  nationalCorporationId: ObjectId
): Promise<NationalizationLedgerEntry[]> {
  return db
    .collection<NationalizationLedgerEntry>(COLLECTION)
    .find({
      nationalCorporationId,
      kind: { $in: ["nationalize_sector", "nationalize_whole"] },
    })
    .sort({ turn: -1, createdAt: -1 })
    .toArray();
}

/**
 * All ledger rows for a whole country (across every NatCorp — primary and
 * split-offs), newest first. Powers the public country-wide State Ownership
 * Register; the per-NatCorp read above still backs the Overview acquisition
 * grouping.
 */
export async function getCountryNationalizationLedger(
  db: Db,
  countryId: CountryId
): Promise<NationalizationLedgerEntry[]> {
  return db
    .collection<NationalizationLedgerEntry>(COLLECTION)
    .find({ countryId })
    .sort({ turn: -1, createdAt: -1 })
    .toArray();
}
