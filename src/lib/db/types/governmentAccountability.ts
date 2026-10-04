import type { CountryId } from "@/lib/constants/countries";

/** Observed continuous responsibility, keyed by country, scope and party. */
export interface GovernmentAccountability {
  _id: string;
  countryId: CountryId;
  stateId: string | null;
  /** Party id, or a namespaced actor key for an unaffiliated executive. */
  partyId: string;
  sinceTurn: number;
  lastObservedTurn: number;
  responsibility: number;
  approval: number;
}
