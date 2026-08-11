import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

/** IMF bailout loans owed to a lender corporation (anchor ₳ principal outstanding). */
export type ImfFacilityReceivableRow = {
  borrowerCorporationId: string;
  borrowerName: string;
  sequentialId?: number;
  principalOutstanding: number;
  annualRatePercent: number;
  amortizationTurnsRemaining: number;
  /** Snapshot on facility; used for payment preview (same cap as turn processing). */
  incomeCaptureFraction?: number;
  logoUrl: string | null;
  brandColor: string | null;
};

/**
 * Corporations in active IMF restructuring where this corporation is the IMF lender.
 * Principal is the carrying value of the loan asset (not tradable bonds).
 *
 * **Unit contract**: `principalOutstanding` and `totalPrincipal` are returned in
 * ₳ (anchor). Raw `corporation.imfFacilityPrincipalOutstanding` is stored in the
 * borrower's `liquidCurrencyCode` post-Task-18A; anchor-normalizing per-borrower
 * here lets callers sum across borrowers of different home currencies without
 * mixing denominations. Pre-A34 this helper returned the raw LOCAL value and
 * `totalPrincipal` as a mixed-currency sum while JSDoc + consumers treated it
 * as ₳ — off by the borrower's FX rate (up to ~100× for JP borrowers).
 */
export async function findImfFacilityReceivablesForLender(
  db: Db,
  lenderCorporationId: ObjectId
): Promise<{ receivables: ImfFacilityReceivableRow[]; totalPrincipal: number }> {
  const rows = await db
    .collection<Corporation>("corporations")
    .find({
      imfBailoutActive: true,
      imfBailoutImfCorporationId: lenderCorporationId,
    })
    .project<
      Pick<
        Corporation,
        | "_id"
        | "name"
        | "sequentialId"
        | "imfFacilityPrincipalOutstanding"
        | "imfFacilityAnnualRate"
        | "imfFacilityAmortizationTurnsRemaining"
        | "imfFacilityIncomeCaptureFraction"
        | "logoUrl"
        | "brandColor"
        | "countryId"
        | "liquidCurrencyCode"
      >
    >({
      _id: 1,
      name: 1,
      sequentialId: 1,
      imfFacilityPrincipalOutstanding: 1,
      imfFacilityAnnualRate: 1,
      imfFacilityAmortizationTurnsRemaining: 1,
      imfFacilityIncomeCaptureFraction: 1,
      logoUrl: 1,
      brandColor: 1,
      countryId: 1,
      liquidCurrencyCode: 1,
    })
    .toArray();

  const fxByCurrency = rows.length > 0 ? await loadFxRatesByCurrency(db) : new Map();

  const receivables: ImfFacilityReceivableRow[] = rows.map((c) => {
    const code = resolveCorpLiquidCurrencyCode(c);
    const rate = fxRateForCorpFromMap(c, fxByCurrency);
    const principalAnchor = corpCapitalToAnchor(c.imfFacilityPrincipalOutstanding ?? 0, code, rate);
    return {
      borrowerCorporationId: c._id.toString(),
      borrowerName: c.name,
      sequentialId: c.sequentialId,
      principalOutstanding: principalAnchor,
      annualRatePercent: c.imfFacilityAnnualRate ?? 0,
      amortizationTurnsRemaining: c.imfFacilityAmortizationTurnsRemaining ?? 0,
      incomeCaptureFraction: c.imfFacilityIncomeCaptureFraction,
      logoUrl: c.logoUrl ?? null,
      brandColor: c.brandColor ?? null,
    };
  });

  const totalPrincipal = receivables.reduce((s, r) => s + r.principalOutstanding, 0);
  return { receivables, totalPrincipal };
}
