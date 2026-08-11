import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";

/**
 * An international organization's pooled treasury. Capitalized by per-turn member
 * dues (a fraction of each member's GDP, set by a member-voted `set_dues`
 * resolution) and drawn down by aid packages and agency funding.
 *
 * One document per organization. The fund is denominated in the **founding
 * country's local currency** (`currencyCountryId` = the org's first founding
 * member; e.g. the EU's fund is in euros via Germany). `balanceLocal` is that
 * currency. All in/out flows convert to/from this currency via each country's
 * `usdExchangeRate`.
 */
export interface OrganizationFund {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  /** Pooled balance in the founding country's local currency. Never negative. */
  balanceLocal: number;
  /** The country whose local currency this fund is denominated in (founder). */
  currencyCountryId: CountryId;
  /** Current annual dues rate (fraction of member GDP), member-voted. */
  duesRateAnnual: number;
  updatedAt: Date;
}
