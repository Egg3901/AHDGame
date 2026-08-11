import { describe, expect, it } from "vitest";
import politicianImages from "@/data/npp-politician-images.json";
import { selectPoliticianImage, weightedRandomEthnicity } from "./generator";
import type { CountryId } from "@/lib/constants/countries";
import type { NPPEthnicity, NPPGender } from "@/lib/db/types";

interface PoliticianImage {
  id: string;
  name: string;
  country: string;
  gender: NPPGender;
  ethnicity: NPPEthnicity;
  url: string;
}

const images = politicianImages as PoliticianImage[];

/** Countries that must have a portrait pool of their own in the data file. */
const POOLED_COUNTRIES = [
  "US",
  "UK",
  "DE",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "RU",
  "IE",
  "AT",
  "GR",
  "FI",
  "JP",
  "CN",
  "NG",
  "BR",
] as const;

/** Countries that borrow another country's pool rather than carrying one. */
const ALIASED_COUNTRIES: Array<[CountryId, string]> = [
  ["DD" as CountryId, "DE"],
  ["SCO" as CountryId, "UK"],
  ["WAL" as CountryId, "UK"],
];

const VALID_ETHNICITIES: NPPEthnicity[] = ["white", "black", "hispanic", "asian", "other"];

describe("npp politician portrait pool", () => {
  it("has a well-formed entry for every portrait", () => {
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.id, `missing id: ${JSON.stringify(image)}`).toBeTruthy();
      expect(image.name.trim().length).toBeGreaterThan(0);
      expect(["male", "female"]).toContain(image.gender);
      expect(VALID_ETHNICITIES).toContain(image.ethnicity);
      // The route redirects to this URL, so a relative or http:// value would
      // break the <img> on an https page.
      expect(image.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    }
  });

  it("has unique ids", () => {
    const ids = images.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(POOLED_COUNTRIES)("gives %s a pool deep enough for both genders", (country) => {
    const pool = images.filter((i) => i.country === country);
    expect(pool.length).toBeGreaterThanOrEqual(40);
    expect(pool.filter((i) => i.gender === "female").length).toBeGreaterThanOrEqual(10);
    expect(pool.filter((i) => i.gender === "male").length).toBeGreaterThanOrEqual(10);
  });

  it("selects a portrait for every pooled country", () => {
    for (const country of POOLED_COUNTRIES) {
      const url = selectPoliticianImage(
        country as CountryId,
        "male",
        weightedRandomEthnicity(country as CountryId),
        "Fictional Nobody"
      );
      expect(url, `no portrait for ${country}`).toMatch(/^\/api\/images\/npp-politicians\//);
    }
  });

  it.each(ALIASED_COUNTRIES)("routes %s to the %s pool", (country, poolCountry) => {
    const poolIds = new Set(images.filter((i) => i.country === poolCountry).map((i) => i.id));
    const url = selectPoliticianImage(country, "female", "white", "Fictional Nobody");
    expect(url).toBeDefined();
    expect(poolIds.has(url!.split("/").pop()!)).toBe(true);
  });

  it("never returns the portrait of a real person the NPP is named after", () => {
    const sample = images.find((i) => i.country === "US")!;
    // 200 draws from a pool this size would hit the excluded portrait many
    // times over if the name filter were not applied.
    for (let i = 0; i < 200; i++) {
      const url = selectPoliticianImage(
        "US" as CountryId,
        sample.gender,
        sample.ethnicity,
        sample.name
      );
      expect(url).not.toBe(`/api/images/npp-politicians/${sample.id}`);
    }
  });

  it("weights ethnicity to match the portrait tags each country carries", () => {
    // The exact-match tier of selectPoliticianImage only ever fires when the
    // generated ethnicity matches how that country's portraits are tagged.
    const dominant: Array<[CountryId, NPPEthnicity]> = [
      ["JP" as CountryId, "asian"],
      ["CN" as CountryId, "asian"],
      ["NG" as CountryId, "black"],
      ["BR" as CountryId, "hispanic"],
      ["FR" as CountryId, "white"],
      ["RU" as CountryId, "white"],
    ];

    for (const [country, expected] of dominant) {
      const draws = Array.from({ length: 400 }, () => weightedRandomEthnicity(country));
      const hits = draws.filter((d) => d === expected).length;
      expect(hits / draws.length, `${country} should mostly draw ${expected}`).toBeGreaterThan(0.5);
    }
  });
});
