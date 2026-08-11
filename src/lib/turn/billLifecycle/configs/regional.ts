import {
  getRegionalBillAssentTitleForState,
  getRegionalExecutiveOfficeKey,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { subNationalChamberSeats } from "@/lib/constants/states";
import type { State } from "@/lib/db/types";

/**
 * Regional (sub-national) bill lifecycle config — the engine's `level:
 * "regional"` counterpart to the per-country national configs. One GLOBAL
 * config: the walker runs across every country's stateBills in one phase, so
 * country variation lives in per-bill helper bindings, not per-country configs.
 *
 * Stage graph (statuses owned by the TURN resolver; player sign/veto and
 * override-vote casting live in `stateBillActions.ts`):
 *   active → (passed | enacted-when-no-executive | failed)
 *   passed → enacted (governor deadline auto-sign)
 *   veto_override → (enacted | override_failed)
 */
export const REGIONAL_LIFECYCLE_CONFIG = {
  level: "regional",
  collection: "stateBills",
  stages: {
    chamberVote: {
      status: "active",
      /** Transient claim status; reverted on resolver throw (#2991). */
      closingStatus: "vote_closing",
      passRule: "simpleMajority",
      onPassStatus: "passed",
      /** Regions with no seated executive skip assent entirely. */
      onPassNoExecutiveStatus: "enacted",
      onRejectStatus: "failed",
    },
    executiveAssent: {
      status: "passed",
      windowHours: 24,
      onTimeoutStatus: "enacted",
    },
    override: {
      status: "veto_override",
      closingStatus: "override_closing",
      threshold: "twoThirdsSeats",
      onPassStatus: "enacted",
      onFailStatus: "override_failed",
    },
  },
  /** officeType votes are scoped against (the sub-national chamber). */
  officeTypeFor: (countryId: CountryId) => getSubNationalLegislatureKey(countryId),
  /** officeType of the regional chief executive (US "governor", DE "ministerPresident", …). */
  executiveOfficeKeyFor: (countryId: CountryId) => getRegionalExecutiveOfficeKey(countryId),
  executiveTitleFor: (countryId: CountryId, stateId: string) =>
    getRegionalBillAssentTitleForState(countryId, stateId),
  /** `preset` is the active world preset — CN's chamber is era-sized (#3779). */
  chamberSeatsFor: (countryId: CountryId, state: State, preset: string | undefined) =>
    subNationalChamberSeats(countryId, state, preset),
} as const;

export type RegionalLifecycleConfig = typeof REGIONAL_LIFECYCLE_CONFIG;
