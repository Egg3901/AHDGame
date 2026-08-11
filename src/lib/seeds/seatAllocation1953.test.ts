/**
 * Regression: 1953-default legislature party seats must sum to each country's
 * configured lowerChamber.totalSeats. Confirmed audit failures: UK 806≠650,
 * IT 945≠630 — caused by (a) econ-tier/backfill seating `deputy` while
 * elections seat `cameraDeputati` (double count), and (b) uniform token
 * incumbents that never allocate a chamber-sized proportional split.
 */
import { describe, it, expect } from "vitest";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { allocateSeatsByWeights } from "@/lib/sim/backfillMissingSeats";
import { buildProportionalChamberSeats, sumSeatsHeld } from "@/lib/seeds/proportionalChamberSeats";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { itRegions1953 } from "@/lib/seeds/it/itRegions1953";
import { frRegions1953 } from "@/lib/seeds/fr/frRegions1953";
import { esRegions1953 } from "@/lib/seeds/es/esRegions1953";
import { seRegions1953 } from "@/lib/seeds/se/seRegions1953";
import { trRegions1953 } from "@/lib/seeds/tr/trRegions1953";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { jpRegions1953 } from "@/lib/seeds/jp/jpRegions1953";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { plRegions1953 } from "@/lib/seeds/pl/plRegions1953";
import { roRegions1953 } from "@/lib/seeds/ro/roRegions1953";
import { yuRegions1953 } from "@/lib/seeds/yu/yuRegions1953";
import { huRegions1953 } from "@/lib/seeds/hu/huRegions1953";
import { csRegions1953 } from "@/lib/seeds/cs/csRegions1953";
import { bgRegions1953 } from "@/lib/seeds/bg/bgRegions1953";
import { states1953 as usStates1953 } from "@/lib/seeds/reference/states1953";
import type { State } from "@/lib/db/types";

const PRESET = "1953-default";

/** Beta chamber election types that must resolve to the office-type key. */
const BETA_CHAMBER_OFFICE: Array<{
  countryId: CountryId;
  electionType: string;
  officeType: string;
}> = [
  { countryId: "FR", electionType: "assembleeNationale", officeType: "deputy" },
  { countryId: "IT", electionType: "cameraDeputati", officeType: "deputy" },
  // ES 1953 Cortes: procurador (era overlay), not modern deputy.
  { countryId: "ES", electionType: "congresoDiputados", officeType: "procurador" },
  { countryId: "SE", electionType: "riksdag", officeType: "member" },
  { countryId: "TR", electionType: "milletMeclisi", officeType: "deputy" },
];

describe("1953 seat office-type unification", () => {
  it.each(BETA_CHAMBER_OFFICE)(
    "$countryId: election winners store officeType $officeType (not chamber key $electionType)",
    ({ countryId, electionType, officeType }) => {
      expect(getOfficeTypeForChamber(countryId, electionType, PRESET)).toBe(officeType);
      // Elections must clear/replace the SAME officeType that econ-tier + backfill seed,
      // otherwise party seats double-count (IT audit: deputy 630 + senato 315 = 945).
      expect(officeKeyForElectionType(electionType, countryId, PRESET)).toBe(officeType);
    }
  );
});

describe("allocateSeatsByWeights sums exactly", () => {
  it("UK-shaped 1951 weights over Commons seats sum exactly", () => {
    const target = getCountryConfig("UK", PRESET).legislature.lowerChamber.seats;
    // Approximate national 1951 GE shares (Con 48 / Lab 48.8 / Lib 2.5).
    const out = allocateSeatsByWeights(
      target,
      new Map([
        ["lab", 48.8],
        ["con", 48.0],
        ["lib", 2.5],
      ])
    );
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(target);
    expect(out.get("lab")).toBeGreaterThan(target * 0.4);
    expect(out.get("con")).toBeGreaterThan(target * 0.4);
    expect(out.get("lib") ?? 0).toBeLessThan(target * 0.05);
  });
});

describe("buildProportionalChamberSeats", () => {
  it("UK: proportional split sums exactly to configured Commons seats", () => {
    const target = getCountryConfig("UK", PRESET).legislature.lowerChamber.seats;
    const seats = buildProportionalChamberSeats({
      officeType: "commons",
      regions: ukRegions1953.map((r) => ({
        id: String(r._id),
        seats: r.houseDistricts ?? 0,
      })),
      parties: [
        { name: "Labour Party", weight: 48.8 },
        { name: "Conservative Party", weight: 48.0 },
        { name: "Liberal Party", weight: 2.5 },
      ],
      targetSeats: target,
    });
    expect(sumSeatsHeld(seats)).toBe(target);
    expect(sumSeatsHeld(seats)).not.toBe(806);
  });

  it("IT: proportional split sums exactly to configured Camera seats", () => {
    const target = getCountryConfig("IT", PRESET).legislature.lowerChamber.seats;
    const seats = buildProportionalChamberSeats({
      officeType: "deputy",
      regions: itRegions1953.map((r) => ({
        id: String(r._id),
        seats: r.houseDistricts ?? 0,
      })),
      parties: [
        { name: "Democrazia Cristiana", weight: 40 },
        { name: "Partito Comunista Italiano", weight: 23 },
        { name: "Partito Socialista Italiano", weight: 13 },
        { name: "Movimento Sociale Italiano", weight: 6 },
        { name: "Partito Repubblicano Italiano", weight: 5 },
      ],
      targetSeats: target,
    });
    expect(sumSeatsHeld(seats)).toBe(target);
    expect(sumSeatsHeld(seats)).not.toBe(945);
  });
});

/** Spot-check: region houseDistricts vs configured lowerChamber.seats for 1953. */
const REGION_SETS: Array<{ id: CountryId; regions: State[] }> = [
  { id: "UK", regions: ukRegions1953 },
  { id: "IT", regions: itRegions1953 },
  { id: "FR", regions: frRegions1953 },
  { id: "ES", regions: esRegions1953 },
  { id: "SE", regions: seRegions1953 },
  { id: "TR", regions: trRegions1953 },
  { id: "DE", regions: deRegions1953 },
  { id: "JP", regions: jpRegions1953 },
  { id: "IE", regions: ieRegions1953 },
  { id: "BR", regions: brRegions1953 },
  { id: "CN", regions: cnRegions1953 },
  { id: "NG", regions: ngRegions1953 },
  { id: "DD", regions: ddRegions1953 },
  { id: "RU", regions: ruRegions1953 },
  { id: "PL", regions: plRegions1953 },
  { id: "RO", regions: roRegions1953 },
  { id: "YU", regions: yuRegions1953 },
  { id: "HU", regions: huRegions1953 },
  { id: "CS", regions: csRegions1953 },
  { id: "BG", regions: bgRegions1953 },
  { id: "US", regions: usStates1953.filter((s) => (s.houseDistricts ?? 0) > 0) },
];

describe("1953 region houseDistricts vs lowerChamber.seats", () => {
  it.each(REGION_SETS)(
    "$id houseDistricts sum equals configured lowerChamber.seats",
    ({ id, regions }) => {
      const config = getCountryConfig(id, PRESET);
      const target = config.legislature.lowerChamber?.seats;
      if (!target) return;
      const sum = regions.reduce((n, r) => n + (r.houseDistricts ?? 0), 0);
      expect(sum, `${id}: HD sum ${sum} vs config ${target}`).toBe(target);
    }
  );
});
