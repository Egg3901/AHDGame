import type { Db } from "mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import type { CentralBank } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import { fetchLocLedgerForCharacter } from "@/lib/lineOfCredit/ledger";
import { getBankId } from "@/lib/centralBank/helpers";

const DEFAULT_PRIME = 2.5;

export async function loadCountryCentralBankLoc(params: {
  db: Db;
  countryId: CountryId;
  userId: string;
  isAdmin: boolean;
}) {
  const { db, countryId, userId, isAdmin } = params;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { ok: false as const, status: 404, error: "Country not found" };
  }
  if (!FOREX_ACTIVE_COUNTRIES.includes(countryId)) {
    return {
      ok: false as const,
      status: 404,
      error: "Line of credit is not available for this country.",
    };
  }

  const [forexEnabled, character, bank] = await Promise.all([
    isForexEnabled(),
    getCharacterByUserId(db, userId),
    db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
  ]);

  if (!character) {
    return { ok: false as const, status: 404, error: "Character not found" };
  }
  if (!forexEnabled) {
    return { ok: false as const, status: 404, error: "Line of credit requires the forex system." };
  }

  const nationalCurrency = COUNTRY_CURRENCY_MAP[countryId];
  const primeRate = bank?.primeRate ?? DEFAULT_PRIME;
  const snapshot = await buildLocSnapshot(db, character);
  const ledger = snapshot ? await fetchLocLedgerForCharacter(db, character._id, 75) : [];

  return {
    ok: true as const,
    body: {
      countryId,
      currencyCode: nationalCurrency,
      primeRate,
      characterId: character._id.toString(),
      snapshot,
      ledger,
      isAdmin,
    },
  };
}
