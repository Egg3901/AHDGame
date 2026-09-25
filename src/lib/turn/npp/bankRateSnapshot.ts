import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import type { RelocationPrimeBank } from "@/lib/corporations/issueRelocationBond";

/** One projected snapshot serves plant pricing and relocation credit quotes. */
export async function loadNppBankRateSnapshot(db: Db, countryIds: ReadonlyArray<CountryId>) {
  const bankRates: RelocationPrimeBank[] = await db
    .collection<CentralBank>("centralBanks")
    .find({}, { projection: { _id: 1, countryId: 1, primeRate: 1 } })
    .toArray();
  const rateByBankId = new Map(bankRates.map((bank) => [bank._id, bank.primeRate]));
  const primeByCountry = new Map<string, number>(
    countryIds.map((countryId) => [
      countryId,
      rateByBankId.get(getBankId(countryId)) ??
        getCountryConfig(countryId).centralBank.defaultPrimeRate,
    ])
  );
  return { bankRates, primeByCountry };
}
