/**
 * v1Readiness — assess whether a country is *seeded* well enough for the NPP
 * autonomy V1 governing brain to actually produce a functioning government.
 *
 * Flipping the autonomy level to v1 only matters if the country has the entities
 * the brain reads: NPP politicians to staff offices, parties to govern through, a
 * legislature to seat a head of government / governing party, cabinet posts to
 * fill, and states/regions for ministerial allocation. A country missing any of
 * these (e.g. an unseeded region) will sit inert at v1. This diagnostic surfaces
 * exactly which prerequisites are met per country so an admin can tell, before
 * enabling, whether the lights will actually come on.
 *
 * Read-only: pure DB reads, no writes.
 */

import type { Db } from "mongodb";
import {
  COUNTRY_ORDER,
  COUNTRY_CONFIGS,
  isPresidentialGovernmentType,
  type CountryId,
} from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";

export type CheckSeverity = "required" | "recommended";

export interface V1ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Human-readable detail (e.g. a count or why it failed). */
  detail: string;
  severity: CheckSeverity;
}

export interface CountryV1Readiness {
  countryId: CountryId;
  name: string;
  governmentType: string;
  /** Player-enabled countries are governed by players — V1 does not act there. */
  enabledForPlayers: boolean;
  /** All `required` checks pass ⇒ the V1 brain has what it needs. */
  ready: boolean;
  counts: {
    npps: number;
    parties: number;
    lowerChamberNppSeats: number;
    states: number;
    cabinetPositions: number;
  };
  checks: V1ReadinessCheck[];
}

/** Assess one country's V1 readiness from its seeded entities. */
export async function assessCountryV1Readiness(
  db: Db,
  countryId: CountryId
): Promise<CountryV1Readiness> {
  const config = COUNTRY_CONFIGS[countryId];
  const presidential = isPresidentialGovernmentType(config.governmentType);
  const lowerOffice = getLowerChamberOfficeType(countryId);

  const [npps, parties, lowerChamberNppSeats, states, enabledForPlayers] = await Promise.all([
    db.collection("npps").countDocuments({ countryId, retiredAt: null }),
    db.collection("politicalParties").countDocuments({ countryId, isDefunct: { $ne: true } }),
    db
      .collection("electedOfficials")
      .countDocuments({ countryId, officeType: lowerOffice, isNPP: true }),
    db.collection("states").countDocuments({ countryId }),
    isCountryEnabledForPlayers(db, countryId),
  ]);
  const cabinetPositions = getCabinetPositions(countryId).length;

  // The legislature seat check is required for parliamentary / one-party systems
  // (the head of government comes from the chamber); for a presidential system
  // the executive is seated independently, so it is only recommended there.
  const seatSeverity: CheckSeverity = presidential ? "recommended" : "required";

  const checks: V1ReadinessCheck[] = [
    {
      id: "states",
      label: "States / regions seeded",
      ok: states > 0,
      detail: states > 0 ? `${states} states` : "no states — ministerial/economy layers inert",
      severity: "required",
    },
    {
      id: "npps",
      label: "NPP politicians seeded",
      ok: npps > 0,
      detail: npps > 0 ? `${npps} active NPPs` : "none — no one to staff offices",
      severity: "required",
    },
    {
      id: "parties",
      label: "Active parties seeded",
      ok: parties > 0,
      detail: parties > 0 ? `${parties} parties` : "none — no party to govern through",
      severity: "required",
    },
    {
      id: "lowerSeats",
      label: "Lower-chamber NPP seats",
      ok: lowerChamberNppSeats > 0,
      detail:
        lowerChamberNppSeats > 0
          ? `${lowerChamberNppSeats} NPP seats`
          : "none — cannot form a governing party / PM",
      severity: seatSeverity,
    },
    {
      id: "cabinet",
      label: "Cabinet positions defined",
      ok: cabinetPositions > 0,
      detail: cabinetPositions > 0 ? `${cabinetPositions} posts` : "no cabinet posts configured",
      severity: "recommended",
    },
  ];

  const ready = checks.filter((c) => c.severity === "required").every((c) => c.ok);

  return {
    countryId,
    name: config.name,
    governmentType: config.governmentType,
    enabledForPlayers,
    ready,
    counts: { npps, parties, lowerChamberNppSeats, states, cabinetPositions },
    checks,
  };
}

/** Assess V1 readiness for every registered country, in display order. */
export async function assessAllV1Readiness(db: Db): Promise<CountryV1Readiness[]> {
  return Promise.all(COUNTRY_ORDER.map((id) => assessCountryV1Readiness(db, id)));
}
