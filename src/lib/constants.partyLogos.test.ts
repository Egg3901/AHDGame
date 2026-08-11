import { describe, expect, it } from "vitest";
import { PARTY_LOGOS } from "./constants";
import { politicalParties as usParties } from "./seeds/reference/politicalParties";
import { ukParties } from "./seeds/uk/ukParties";
import { deParties } from "./seeds/de/deParties";
import { jpParties } from "./seeds/jp/jpParties";
import { brParties } from "./seeds/br/brParties";
import { ieParties } from "./seeds/ie/ieParties";
import { cnParties } from "./seeds/cn/cnParties";
import { ruParties } from "./seeds/ru/ruParties";
import { ddParties } from "./seeds/dd/ddParties";

const ALL_SEEDS = [
  ...usParties,
  ...ukParties,
  ...deParties,
  ...jpParties,
  ...brParties,
  ...ieParties,
  ...cnParties,
  ...ruParties,
  ...ddParties,
];

describe("PARTY_LOGOS keying", () => {
  it("every key resolves to a seeded (country, abbreviation) pair", () => {
    // Logos are looked up by `${country}:${abbreviation}` so they stay
    // stable across reset presets (sequentialId shifts when 2019-only or
    // 1991-only seeds are filtered out — see deParties PDS=6/Linke=6).
    const seededKeys = new Set(ALL_SEEDS.map((seed) => `${seed.countryId}:${seed.abbreviation}`));
    const orphanedKeys = Object.keys(PARTY_LOGOS).filter((key) => !seededKeys.has(key));
    expect(orphanedKeys).toEqual([]);
  });

  it("never re-introduces sequentialId-shaped keys", () => {
    // `${country}:${number}` was the legacy keying scheme that caused
    // preset-specific defaults to inherit each other's logos on fresh
    // 1991 boots. Guard against accidental regressions.
    const numericKeys = Object.keys(PARTY_LOGOS).filter((key) => /:\d+$/.test(key));
    expect(numericKeys).toEqual([]);
  });
});
