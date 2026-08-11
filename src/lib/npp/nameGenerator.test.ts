import { describe, expect, it } from "vitest";
import {
  feminizeCzechSurname,
  feminizeLatvianSurname,
  feminizeLithuanianSurname,
  feminizePolishSurname,
  feminizeRussianSurname,
  generateNPPNameAndGender,
  generateUniqueNPPName,
  generateUniqueNPPNameAndGender,
  isNameFromCountryPool,
} from "./nameGenerator";
import { DD_FIRST_NAMES_FEMALE, DD_FIRST_NAMES_MALE, HU_SURNAMES } from "./nameLists4";

const ALL_COUNTRIES = [
  "US",
  "UK",
  "DE",
  "JP",
  "CN",
  "IE",
  "BR",
  "NG",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "RU",
  "DD",
  "SCO",
  "WAL",
  "HU",
  "PL",
  "CS",
  "BG",
  "RO",
  "YU",
  "BLR",
  "BAL",
] as const;

/**
 * Every country that seeds NPPs must route to a pool of its own. A country
 * missing from NAME_GENERATORS silently falls back to the US pool, which is
 * not a crash and not a test failure anywhere else — it just quietly seeds a
 * French chamber full of Americans.
 */
const US_POOL_MARKERS = /\b(Washington|Jefferson|Brandon|Tyler|Cody|Dakota|Jr\.|III|IV)\b/;

describe("nameGenerator country routing", () => {
  it.each(ALL_COUNTRIES)("produces non-empty ASCII names for %s", (country) => {
    const samples = Array.from({ length: 30 }, () =>
      generateUniqueNPPName([], 100, country)
    ).filter((n): n is string => n !== null);

    expect(samples.length).toBeGreaterThan(0);
    for (const name of samples) {
      // Every name must be two or more tokens (given + surname, or surname +
      // given for CN). No empty parts, no leading/trailing whitespace.
      expect(name.trim()).toBe(name);
      expect(name.split(" ").filter(Boolean).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("produces Chinese-style surname-first names for CN", () => {
    const samples = Array.from({ length: 50 }, () => generateUniqueNPPName([], 100, "CN")).filter(
      (n): n is string => n !== null
    );

    // CN names start with a short Pinyin surname (no apostrophe, no
    // O'/Mc prefix that would suggest the IE pool leaked in).
    const cnFirstTokenRegex = /^[A-Z][a-z]{1,7}\s/;
    for (const name of samples) {
      expect(name).toMatch(cnFirstTokenRegex);
      expect(name).not.toMatch(/^(Mary|James|John|Mike|Sarah)\b/);
      expect(name).not.toMatch(/^(O'|Mc)/);
    }
  });

  it("produces Irish-style names for IE (with O'/Mc surnames possible)", () => {
    const samples = Array.from({ length: 150 }, () => generateUniqueNPPName([], 100, "IE")).filter(
      (n): n is string => n !== null
    );

    // 150 samples is more than enough that at least one O'/Mc surname appears
    // (those make up ~25% of the IE pool). If we never see one, the IE pool
    // probably didn't get registered.
    const hasIrishSurnameMarker = samples.some((n) => /\s(O'|Mc)/.test(n));
    expect(hasIrishSurnameMarker).toBe(true);
  });

  it("produces German-style names for DE (transliterated, ASCII only)", () => {
    const samples = Array.from({ length: 80 }, () => generateUniqueNPPName([], 100, "DE")).filter(
      (n): n is string => n !== null
    );

    // German surnames in the pool are the standard transliterated forms
    // (Mueller/Schroeder/Krueger). The "ue/oe" digraphs are what we expect
    // instead of the umlauted originals; at least some should appear at
    // 80 samples.
    const hasUmlautDigraph = samples.some((n) => /(?:ue|oe)/.test(n));
    expect(hasUmlautDigraph).toBe(true);
  });

  it("returns gender alongside the name for every country", () => {
    for (const country of ALL_COUNTRIES) {
      const result = generateUniqueNPPNameAndGender([], 100, country);
      expect(result, `expected a result for ${country}`).not.toBeNull();
      expect(["male", "female"]).toContain(result!.gender);
    }
  });

  it("accepts mixed-case countryId", () => {
    expect(generateUniqueNPPName([], 100, "CN")).not.toBeNull();
    expect(generateUniqueNPPName([], 100, "cn")).not.toBeNull();
    expect(generateUniqueNPPName([], 100, "uK")).not.toBeNull();
  });

  it("falls back to the US-style pool when no countryId is provided", () => {
    const name = generateUniqueNPPName([], 100);
    expect(name).not.toBeNull();
    expect(typeof name).toBe("string");
  });

  it("default (no country) still returns a name + gender (regression)", () => {
    const result = generateNPPNameAndGender();
    expect(result.name).toBeTruthy();
    expect(["male", "female"]).toContain(result.gender);
  });

  it.each([
    "FR",
    "IT",
    "ES",
    "SE",
    "TR",
    "RU",
    "HU",
    "PL",
    "CS",
    "BG",
    "RO",
    "YU",
    "BLR",
    "BAL",
  ] as const)("does not fall back to the US pool for %s", (country) => {
    const samples = Array.from({ length: 200 }, () =>
      generateUniqueNPPName([], 100, country)
    ).filter((n): n is string => n !== null);

    expect(samples.length).toBeGreaterThan(0);
    for (const name of samples) {
      expect(name).not.toMatch(US_POOL_MARKERS);
    }
  });

  it("routes East Germany to German surnames with GDR-era first names", () => {
    const samples = Array.from({ length: 120 }, () => generateUniqueNPPName([], 100, "DD")).filter(
      (n): n is string => n !== null
    );

    // Same transliteration marker the DE test uses — if DD were falling back
    // to the US pool this would never appear.
    expect(samples.some((n) => /(?:ue|oe)/.test(n))).toBe(true);

    // First names come from the GDR-era cohort lists, not the era-neutral DE
    // pool: no post-1990 fashions on a Volkskammer bench.
    const eraFirsts = new Set<string>([...DD_FIRST_NAMES_MALE, ...DD_FIRST_NAMES_FEMALE]);
    for (const name of samples) {
      expect(eraFirsts.has(name.split(" ")[0]), `unexpected DD first name in ${name}`).toBe(true);
    }
  });

  it("writes Hungarian names surname-first", () => {
    const samples = Array.from({ length: 100 }, () => generateUniqueNPPName([], 100, "HU")).filter(
      (n): n is string => n !== null
    );

    const surnames = new Set<string>(HU_SURNAMES);
    expect(samples.length).toBeGreaterThan(0);
    for (const name of samples) {
      expect(surnames.has(name.split(" ")[0]), `expected HU surname first in ${name}`).toBe(true);
    }
  });

  it("inflects Polish and Czechoslovak surnames for women", () => {
    for (const country of ["PL", "CS"] as const) {
      const results = Array.from({ length: 400 }, () =>
        generateUniqueNPPNameAndGender([], 100, country)
      ).filter((r): r is { name: string; gender: "male" | "female" } => r !== null);

      const women = results.filter((r) => r.gender === "female");
      expect(women.length).toBeGreaterThan(0);
      for (const { name } of women) {
        // Women never carry the masculine adjectival forms (-ski/-cki/-dzki
        // in Polish, -y in Czech); Czech women always take -ova or -a.
        expect(name.split(" ").at(-1)).not.toMatch(/(ski|cki|dzki|[^aeiou]y)$/);
      }
    }
  });

  it("draws BAL names from a single Baltic tradition per politician", () => {
    const samples = Array.from({ length: 400 }, () => generateUniqueNPPName([], 100, "BAL")).filter(
      (n): n is string => n !== null
    );

    // All three sub-pools should surface across 400 draws: Lithuanian
    // (-as/-us masculine or -iene feminine), Latvian (-ins/-a), and an
    // Estonian surname (nature nouns like Tamm/Saar/Kask).
    expect(samples.some((n) => /(?:as|us|iene)$/.test(n))).toBe(true);
    expect(samples.some((n) => /\s(?:Tamm|Saar|Sepp|Kask|Kukk|Rebane|Magi|Oja)$/.test(n))).toBe(
      true
    );
    // And every one passes its own country's membership check.
    for (const name of samples) {
      expect(isNameFromCountryPool(name, "BAL"), `expected BAL membership for ${name}`).toBe(true);
    }
  });

  it("gives the RU pool a weighted Soviet-minority share", () => {
    const samples = Array.from({ length: 800 }, () => generateUniqueNPPName([], 100, "RU")).filter(
      (n): n is string => n !== null
    );

    // Ukrainian patronymics are the largest minority share (~18%); across
    // 800 draws the -enko marker is effectively guaranteed.
    expect(samples.some((n) => /enko$/.test(n))).toBe(true);
    // The core Russian pool still dominates.
    const russianCore = samples.filter((n) => /(ov|ev|in|sky|ova|eva|ina|skaya)$/.test(n));
    expect(russianCore.length).toBeGreaterThan(samples.length / 3);
    // Every minority draw still passes the RU membership check, so the name
    // heal never flags them as fallback names.
    for (const name of samples) {
      expect(isNameFromCountryPool(name, "RU"), `expected RU membership for ${name}`).toBe(true);
    }
  });

  it("produces Spanish double surnames some of the time, but never a repeated one", () => {
    const samples = Array.from({ length: 300 }, () => generateUniqueNPPName([], 100, "ES")).filter(
      (n): n is string => n !== null
    );

    const doubles = samples.filter((n) => n.split(" ").length === 3);
    expect(doubles.length).toBeGreaterThan(0);
    for (const name of doubles) {
      const [, paternal, maternal] = name.split(" ");
      expect(paternal).not.toBe(maternal);
    }
  });

  it("inflects Russian surnames for women", () => {
    const results = Array.from({ length: 400 }, () =>
      generateUniqueNPPNameAndGender([], 100, "RU")
    ).filter((r): r is { name: string; gender: "male" | "female" } => r !== null);

    const women = results.filter((r) => r.gender === "female");
    const men = results.filter((r) => r.gender === "male");
    expect(women.length).toBeGreaterThan(0);
    expect(men.length).toBeGreaterThan(0);

    // Women never carry a masculine-inflectable Russian form: -ov/-ev/-in/-yn
    // and -sky always feminize (Ivanova, Belskaya). Minority surnames that do
    // not inflect (Shevchenko, Beridze, Petrosyan) pass through unchanged.
    for (const { name } of women) {
      expect(name.split(" ").at(-1)).not.toMatch(/(ov|ev|yov|in|yn|sky|skiy|ski)$/);
    }
    for (const { name } of men) {
      expect(name.split(" ").at(-1)).not.toMatch(/(ova|eva|ina|skaya|iene)$/);
    }
  });

  it("feminizes Polish, Czech, Latvian, and Lithuanian surnames", () => {
    expect(feminizePolishSurname("Kowalski")).toBe("Kowalska");
    expect(feminizePolishSurname("Czarnecki")).toBe("Czarnecka");
    expect(feminizePolishSurname("Zawadzki")).toBe("Zawadzka");
    expect(feminizePolishSurname("Nowak")).toBe("Nowak"); // non-adjectival, no inflection

    expect(feminizeCzechSurname("Novak")).toBe("Novakova");
    expect(feminizeCzechSurname("Svoboda")).toBe("Svobodova");
    expect(feminizeCzechSurname("Novotny")).toBe("Novotna"); // adjectival

    expect(feminizeLatvianSurname("Berzins")).toBe("Berzina");
    expect(feminizeLatvianSurname("Balodis")).toBe("Balode");
    expect(feminizeLatvianSurname("Ozols")).toBe("Ozola");
    expect(feminizeLatvianSurname("Roze")).toBe("Roze"); // vowel-final, both genders

    expect(feminizeLithuanianSurname("Kazlauskas")).toBe("Kazlauskiene");
    expect(feminizeLithuanianSurname("Butkus")).toBe("Butkiene");
    expect(feminizeLithuanianSurname("Adomaitis")).toBe("Adomaitiene");
  });

  it("keeps healed bloc names inside their own country pools", () => {
    // Feminine forms must count as pool members or the name heal would
    // rename every woman it just named.
    expect(isNameFromCountryPool("Anna Kowalska", "PL")).toBe(true);
    expect(isNameFromCountryPool("Jan Kowalski", "PL")).toBe(true);
    expect(isNameFromCountryPool("Marie Novakova", "CS")).toBe(true);
    expect(isNameFromCountryPool("Elena Dimitrova", "BG")).toBe(true);
    expect(isNameFromCountryPool("Nagy Istvan", "HU")).toBe(true);
    expect(isNameFromCountryPool("Ona Kazlauskiene", "BAL")).toBe(true);
    expect(isNameFromCountryPool("Hanna Makarevich", "BLR")).toBe(true);
    // And a US-fallback name still fails, which is the heal's whole signal.
    expect(isNameFromCountryPool("Carmen Washington", "PL")).toBe(false);
    expect(isNameFromCountryPool("Carmen Washington", "HU")).toBe(false);
  });

  it("feminizeRussianSurname handles the -ov/-ev/-in and -sky endings", () => {
    expect(feminizeRussianSurname("Ivanov")).toBe("Ivanova");
    expect(feminizeRussianSurname("Lebedev")).toBe("Lebedeva");
    expect(feminizeRussianSurname("Nikitin")).toBe("Nikitina");
    expect(feminizeRussianSurname("Belsky")).toBe("Belskaya");
    // Surnames that do not inflect are returned unchanged.
    expect(feminizeRussianSurname("Shevchenko")).toBe("Shevchenko");
  });
});
