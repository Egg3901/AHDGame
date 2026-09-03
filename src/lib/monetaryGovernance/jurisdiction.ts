/**
 * Jurisdiction shell: resolve the canonical monetary institution for a URL country.
 *
 * A shared-currency bank (the ECB for its members, the Bank of England for the
 * UK, SCO and WAL) has exactly one authoritative centralBanks document, and
 * the URL's country is only a viewpoint onto it. Every central-bank and fomc
 * route resolves through here so policy controls cannot leak across
 * jurisdictions: a command carrying a country outside the membership is
 * refused, and committee actions exist only on committee institutions.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { FOMC_COMMITTEE_COUNTRY_IDS } from "@/lib/db/types/centralBank";
import {
  getBankId,
  getCentralBankScope,
  getConfiguredSharedBankMemberCountries,
} from "@/lib/centralBank/helpers";

export interface JurisdictionResolution {
  /** The canonical centralBanks._id for the currency area. */
  institutionId: string;
  currency: string;
  /** Every country sharing this institution, anchor first. */
  memberCountryIds: CountryId[];
  /** The home country of the institution (owns the document). */
  anchorCountryId: CountryId;
  /** Whether the viewpoint country is the anchor member. */
  isAnchor: boolean;
  /** Whether this institution runs the committee model (US-only). */
  committeeBank: boolean;
}

export async function resolveJurisdiction(
  db: Db,
  countryId: CountryId
): Promise<JurisdictionResolution> {
  const bankId = getBankId(countryId);
  const scope = await getCentralBankScope(db, countryId);
  const configured = getConfiguredSharedBankMemberCountries(bankId);
  const members = [...new Set<CountryId>([...scope.memberCountries, ...configured])];

  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId }, { projection: { countryId: 1 } });
  const docCountry = bank?.countryId as CountryId | undefined;
  const anchorCountryId: CountryId =
    docCountry && members.includes(docCountry)
      ? docCountry
      : ((COUNTRY_CONFIGS[bankId as CountryId] ? (bankId as CountryId) : members[0]) as CountryId);

  const ordered = [anchorCountryId, ...members.filter((m) => m !== anchorCountryId)];

  return {
    institutionId: bankId,
    currency: COUNTRY_CURRENCY_MAP[countryId],
    memberCountryIds: ordered,
    anchorCountryId,
    isAnchor: countryId === anchorCountryId,
    committeeBank: FOMC_COMMITTEE_COUNTRY_IDS.has(anchorCountryId),
  };
}
