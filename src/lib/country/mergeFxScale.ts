/**
 * The FX scale a country merge converts the absorbed side's money at.
 *
 * ONE rate source for every pot of money that crosses a border in a merge:
 * `loadFxScalePair` is shared with `convertTransferredResidentsCurrency` (the
 * per-region resident/corp converter), so the national treasury, the bonds,
 * the party funds and the region residents all cross at one price — the
 * alternative is two hand-synchronized copies of the rate lookup that drift
 * into a silent value transfer.
 *
 * The two callers keep DIFFERENT missing-rate policies on top of it, on
 * purpose: the resident converter REFUSES (its region already moved; balances
 * can be re-converted later), while a national merge must not — the absorbed
 * country stops existing, so money left unconverted is money parked on a dead
 * ledger with no later pass to fix it. A missing rate here converts at 1 with
 * a loud error instead.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";

export type FxScalePair =
  /**
   * Currencies differ and both sides have a usable rate. Carries the codes and
   * the loaded rate table so a caller converting individual balances (wallet
   * relabeling, `convertCorpCurrency`) does not re-derive or re-load them.
   */
  | {
      kind: "convert";
      scale: number;
      oldCurrency: CurrencyCode;
      newCurrency: CurrencyCode;
      fxByCurrency: Map<CurrencyCode, number>;
    }
  /** Forex disabled, or the two countries share a currency: nothing converts. */
  | { kind: "no-conversion" }
  /** Currencies differ but a usable rate is missing: policy is the caller's. */
  | { kind: "missing-rate" };

export async function loadFxScalePair(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<FxScalePair> {
  if (!(await isForexEnabled())) return { kind: "no-conversion" };

  const oldCurrency = COUNTRY_CURRENCY_MAP[fromCountryId];
  const newCurrency = COUNTRY_CURRENCY_MAP[toCountryId];
  if (!oldCurrency || !newCurrency || oldCurrency === newCurrency) {
    return { kind: "no-conversion" };
  }

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const fromRate = fxByCurrency.get(oldCurrency);
  const toRate = fxByCurrency.get(newCurrency);
  if (fromRate === undefined || toRate === undefined || fromRate <= 0 || toRate <= 0) {
    return { kind: "missing-rate" };
  }
  return { kind: "convert", scale: toRate / fromRate, oldCurrency, newCurrency, fxByCurrency };
}

export async function resolveMergeFxScale(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<number> {
  const pair = await loadFxScalePair(db, fromCountryId, toCountryId);
  if (pair.kind === "convert") return pair.scale;
  if (pair.kind === "missing-rate") {
    console.error(
      `[mergeFxScale] no usable rate for ${fromCountryId}->${toCountryId}; converting at 1. ` +
        `National balances may be misdenominated and need a heal.`
    );
  }
  return 1;
}
