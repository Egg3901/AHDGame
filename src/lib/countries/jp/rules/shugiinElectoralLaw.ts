/**
 * Japan's 1991 lower house begins under the 512-seat SNTV rules. The 1994
 * mixed system is an approval-gated transition for future elections only.
 * Maps transcribe Acts No. 10/1994 and No. 104/1994, aggregated to game regions.
 */
import { JP_SHUGIIN_SEATS_1991 } from "../data/jpSeats";

export type JapanShugiinElectoralLaw = "sntv-1991-v1" | "mixed-1994-v1";

export interface JapanConstituency {
  id: string;
  regionId: string;
  prefecture: string;
  /** Exact Japanese administrative units listed by the 1994 statute. */
  statutoryBoundary: string;
}

export interface JapanShugiinRuleSnapshot {
  law: JapanShugiinElectoralLaw;
  totalSeats: number;
  districtSeats: number;
  listSeats: number;
}

export interface JapanShugiinMandate {
  law: "mixed-1994-v1";
  passedTurn: number;
  billId: string;
}

/** The approved mixed reform is available only in the 1991 Japan world from 1994 onward. */
export function isJapanShugiinReformEligible(input: {
  preset?: string;
  countryId: string;
  currentYear?: number;
}): boolean {
  return (
    input.preset === "1991-default" &&
    input.countryId === "JP" &&
    Number.isSafeInteger(input.currentYear) &&
    (input.currentYear ?? 0) >= 1994
  );
}

export interface JapanShugiinResolvedRegionalRule {
  ruleVersion: JapanShugiinElectoralLaw;
  totalSeats: number;
  districtSeats: number;
  listSeats: number;
  electionId: string;
  cycle: number;
  resolvedAtTurn: number;
}

export const JP_SHUGIIN_1991_SNTV: JapanShugiinRuleSnapshot = {
  law: "sntv-1991-v1",
  totalSeats: 512,
  districtSeats: 512,
  listSeats: 0,
};

/** 300 constituencies established by Act No. 104/1994, summed by game region. */
export const JP_SHUGIIN_1994_DISTRICT_SEATS: Readonly<Record<string, number>> = {
  HOK: 13,
  TOH: 26,
  KAN: 85,
  CHU: 57,
  KNS: 47,
  CGK: 21,
  SHI: 13,
  KYU: 38,
};

/** 200 proportional-list seats established by Act No. 10/1994, mapped by bloc. */
export const JP_SHUGIIN_1994_LIST_SEATS: Readonly<Record<string, number>> = {
  HOK: 9,
  TOH: 16,
  KAN: 63,
  CHU: 36,
  KNS: 33,
  CGK: 13,
  SHI: 7,
  KYU: 23,
};

/** Immutable seat-capacity snapshot for a newly opened lower-house election. */
export function japanShugiinRuleSnapshot(
  mandate?: JapanShugiinMandate | null
): JapanShugiinRuleSnapshot {
  if (!mandate) return { ...JP_SHUGIIN_1991_SNTV };
  const districtSeats = Object.values(JP_SHUGIIN_1994_DISTRICT_SEATS).reduce(
    (sum, seats) => sum + seats,
    0
  );
  const listSeats = Object.values(JP_SHUGIIN_1994_LIST_SEATS).reduce(
    (sum, seats) => sum + seats,
    0
  );
  return { law: mandate.law, totalSeats: districtSeats + listSeats, districtSeats, listSeats };
}

/** Seat capacity for one game region and tier under a frozen rule snapshot. */
export function japanShugiinRegionSeats(
  snapshot: JapanShugiinRuleSnapshot,
  regionId: string,
  tier: "district" | "list"
): number {
  if (snapshot.law === "sntv-1991-v1") {
    return tier === "district" ? (JP_SHUGIIN_SEATS_1991[regionId] ?? 0) : 0;
  }
  return tier === "district"
    ? (JP_SHUGIIN_1994_DISTRICT_SEATS[regionId] ?? 0)
    : (JP_SHUGIIN_1994_LIST_SEATS[regionId] ?? 0);
}

/** Resolve a frozen regional race capacity only when its stored tier split is law-consistent. */
export function japanShugiinFrozenRegionCapacity(
  snapshot: JapanShugiinRuleSnapshot | undefined,
  regionId: string,
  legacyCapacity: number | undefined
): number | undefined {
  if (!snapshot) return legacyCapacity;
  const legalDistrictSeats = japanShugiinRegionSeats(snapshot, regionId, "district");
  const legalListSeats = japanShugiinRegionSeats(snapshot, regionId, "list");
  if (
    snapshot.districtSeats !== legalDistrictSeats ||
    snapshot.listSeats !== legalListSeats ||
    snapshot.totalSeats !== legalDistrictSeats + legalListSeats
  ) {
    return undefined;
  }
  return legalDistrictSeats + legalListSeats;
}

/** Count the sitting lower-house capacity as regions finish under frozen rules. */
export function japanShugiinCurrentChamberCapacity(
  resolvedRegions?: Readonly<Record<string, JapanShugiinResolvedRegionalRule | undefined>>
): number {
  return Object.entries(JP_SHUGIIN_SEATS_1991).reduce((sum, [regionId, legacySeats]) => {
    const resolved = resolvedRegions?.[regionId];
    const seats = resolved?.totalSeats ?? legacySeats;
    const expectedDistrictSeats = resolved
      ? japanShugiinRegionSeats(
          {
            law: resolved.ruleVersion,
            totalSeats: resolved.totalSeats,
            districtSeats: resolved.districtSeats,
            listSeats: resolved.listSeats,
          },
          regionId,
          "district"
        )
      : legacySeats;
    const expectedListSeats = resolved
      ? japanShugiinRegionSeats(
          {
            law: resolved.ruleVersion,
            totalSeats: resolved.totalSeats,
            districtSeats: resolved.districtSeats,
            listSeats: resolved.listSeats,
          },
          regionId,
          "list"
        )
      : 0;
    if (
      !Number.isSafeInteger(seats) ||
      seats < 1 ||
      (resolved &&
        (!Number.isSafeInteger(resolved.districtSeats) ||
          !Number.isSafeInteger(resolved.listSeats) ||
          resolved.districtSeats < 0 ||
          resolved.listSeats < 0 ||
          resolved.districtSeats + resolved.listSeats !== seats ||
          resolved.districtSeats !== expectedDistrictSeats ||
          resolved.listSeats !== expectedListSeats ||
          resolved.electionId.length === 0 ||
          !Number.isSafeInteger(resolved.cycle) ||
          !Number.isSafeInteger(resolved.resolvedAtTurn)))
    ) {
      throw new Error(`Invalid resolved Shugiin capacity for ${regionId}`);
    }
    return sum + seats;
  }, 0);
}

/** Select the regional rule frozen on a newly opened 1991-world election. */
export function japanShugiinRulesForRegion(
  preset: string | undefined,
  regionId: string,
  legacySeats: number,
  mandate?: JapanShugiinMandate | null
): (JapanShugiinRuleSnapshot & { authorizedOnTurn?: number; reformBillId?: string }) | null {
  if (preset !== "1991-default") return null;
  if (!mandate) {
    if (!Number.isSafeInteger(legacySeats) || legacySeats < 1)
      throw new Error(`Missing 1991 Shugiin seat count for ${regionId}`);
    return {
      law: "sntv-1991-v1",
      totalSeats: legacySeats,
      districtSeats: legacySeats,
      listSeats: 0,
    };
  }
  const districtSeats = japanShugiinRegionSeats(
    japanShugiinRuleSnapshot(mandate),
    regionId,
    "district"
  );
  const listSeats = japanShugiinRegionSeats(japanShugiinRuleSnapshot(mandate), regionId, "list");
  return {
    law: mandate.law,
    totalSeats: districtSeats + listSeats,
    districtSeats,
    listSeats,
    authorizedOnTurn: mandate.passedTurn,
    reformBillId: mandate.billId,
  };
}

/**
 * Pass an introduced reform only when the legislative outcome is explicitly
 * approved. Rejection, delay, wrong era, or malformed evidence preserve state.
 */
export function approveJapanShugiinReform(input: {
  preset?: string;
  countryId: string;
  currentYear?: number;
  outcome: "approved" | "rejected" | "delayed";
  turn: number;
  billId: string;
  current?: JapanShugiinMandate | null;
}): JapanShugiinMandate | null {
  if (input.current) return input.current;
  if (
    !isJapanShugiinReformEligible(input) ||
    input.outcome !== "approved" ||
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    input.billId.trim().length === 0
  ) {
    return input.current ?? null;
  }
  return { law: "mixed-1994-v1", passedTurn: input.turn, billId: input.billId };
}

/** Official statutory sources used for this map:
 * https://www.shugiin.go.jp/internet/itdb_housei.nsf/html/houritsu/12919940311010.htm
 * https://www.shugiin.go.jp/internet/itdb_housei.nsf/html/houritsu/13119941125104.htm
 */
