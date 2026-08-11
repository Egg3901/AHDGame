/**
 * Static assertions that every party slug used in `getPresetSeats(preset)`
 * for the supported presets either:
 *   - is in INDEPENDENT_SLUGS (intentionally folds to independent), OR
 *   - has a SLUG_TO_NAME entry, AND
 *   - the mapped party name exists in the preset-eligible party roster.
 *
 * These tests catch silent slug-resolution failures (party becomes
 * independent because the slug isn't mapped) without needing a live DB.
 */

import { describe, expect, it } from "vitest";
import { SLUG_TO_NAME, INDEPENDENT_SLUGS, buildOfficeType } from "./seedHistorical";
import { getPresetSeats } from "@/lib/constants/historicalSeats";
import { politicalParties as usParties } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { jpParties } from "@/lib/seeds/jp/jpParties";
import { deParties } from "@/lib/seeds/de/deParties";
import { brParties } from "@/lib/seeds/br/brParties";
import { ieParties } from "@/lib/seeds/ie/ieParties";
import { cnParties } from "@/lib/seeds/cn/cnParties";
import { ruParties } from "@/lib/seeds/ru/ruParties";
import { ddParties } from "@/lib/seeds/dd/ddParties";
import { huParties } from "@/lib/seeds/hu/huParties";
import { plParties } from "@/lib/seeds/pl/plParties";
import { roParties } from "@/lib/seeds/ro/roParties";
import { yuParties } from "@/lib/seeds/yu/yuParties";
import { bgParties } from "@/lib/seeds/bg/bgParties";
import { blrParties } from "@/lib/seeds/blr/blrParties";
import { csParties } from "@/lib/seeds/cs/csParties";
import { balParties } from "@/lib/seeds/bal/balParties";
import { isPartyValidForPreset } from "@/lib/seeds/ensureDefaultParties";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

const ALL_PARTIES: PartySeed[] = [
  ...usParties,
  ...ukParties,
  ...jpParties,
  ...deParties,
  ...brParties,
  ...ieParties,
  ...cnParties,
  ...ruParties,
  ...ddParties,
  ...huParties,
  ...plParties,
  ...roParties,
  ...yuParties,
  ...bgParties,
  ...blrParties,
  ...csParties,
  ...balParties,
];

function partyNamesForPreset(preset: string): Set<string> {
  return new Set(ALL_PARTIES.filter((p) => isPartyValidForPreset(p, preset)).map((p) => p.name));
}

function slugsInPreset(preset: string): Set<string> {
  const seats = getPresetSeats(preset);
  return new Set(seats.map((s) => s.party));
}

describe("seedHistorical slug resolution", () => {
  it("1991-default: every party slug in getPresetSeats resolves to a seeded preset-valid party or is whitelisted independent", () => {
    const slugs = slugsInPreset("1991-default");
    const validNames = partyNamesForPreset("1991-default");
    const unresolved: string[] = [];
    for (const slug of slugs) {
      if (INDEPENDENT_SLUGS.has(slug)) continue;
      // US bare-slug exception: 1991/2019 US historical arrays use "democrat" /
      // "republican" rather than "us_democrat" / "us_republican". Both resolve
      // via the runtime regex fallback to "Democratic Party" / "Republican Party".
      if (slug === "democrat") {
        if (!validNames.has("Democratic Party")) unresolved.push(slug);
        continue;
      }
      if (slug === "republican") {
        if (!validNames.has("Republican Party")) unresolved.push(slug);
        continue;
      }
      const name = SLUG_TO_NAME[slug];
      if (!name) {
        unresolved.push(`${slug} (no SLUG_TO_NAME entry)`);
        continue;
      }
      // Independent maps to a non-party concept handled at resolve time.
      if (name === "Independent" || name === "Speaker") continue;
      if (!validNames.has(name)) {
        unresolved.push(`${slug} → "${name}" (not in 1991-preset party roster)`);
      }
    }
    expect(
      unresolved,
      `unresolved party slugs in 1991-preset:\n  ${unresolved.join("\n  ")}`
    ).toEqual([]);
  });

  it("2019-default: every party slug in getPresetSeats resolves to a seeded preset-valid party or is whitelisted independent", () => {
    const slugs = slugsInPreset("2019-default");
    const validNames = partyNamesForPreset("2019-default");
    const unresolved: string[] = [];
    for (const slug of slugs) {
      if (INDEPENDENT_SLUGS.has(slug)) continue;
      if (slug === "democrat") {
        if (!validNames.has("Democratic Party")) unresolved.push(slug);
        continue;
      }
      if (slug === "republican") {
        if (!validNames.has("Republican Party")) unresolved.push(slug);
        continue;
      }
      const name = SLUG_TO_NAME[slug];
      if (!name) {
        unresolved.push(`${slug} (no SLUG_TO_NAME entry)`);
        continue;
      }
      if (name === "Independent" || name === "Speaker") continue;
      if (!validNames.has(name)) {
        unresolved.push(`${slug} → "${name}" (not in 2019-preset party roster)`);
      }
    }
    expect(
      unresolved,
      `unresolved party slugs in 2019-preset:\n  ${unresolved.join("\n  ")}`
    ).toEqual([]);
  });

  it("1979-default: every party slug in getPresetSeats resolves to a seeded preset-valid party or is whitelisted independent", () => {
    const slugs = slugsInPreset("1979-default");
    const validNames = partyNamesForPreset("1979-default");
    const unresolved: string[] = [];
    for (const slug of slugs) {
      if (INDEPENDENT_SLUGS.has(slug)) continue;
      const name = SLUG_TO_NAME[slug];
      if (!name) {
        unresolved.push(`${slug} (no SLUG_TO_NAME entry)`);
        continue;
      }
      if (name === "Independent" || name === "Speaker") continue;
      if (!validNames.has(name)) {
        unresolved.push(`${slug} → "${name}" (not in 1979-preset party roster)`);
      }
    }
    expect(
      unresolved,
      `unresolved party slugs in 1979-preset:\n  ${unresolved.join("\n  ")}`
    ).toEqual([]);
  });

  it("1953-default: every party slug in getPresetSeats resolves to a seeded preset-valid party or is whitelisted independent", () => {
    const slugs = slugsInPreset("1953-default");
    const validNames = partyNamesForPreset("1953-default");
    const unresolved: string[] = [];
    for (const slug of slugs) {
      if (INDEPENDENT_SLUGS.has(slug)) continue;
      // US bare-slug exception — same runtime regex fallback as 1991/2019.
      if (slug === "democrat") {
        if (!validNames.has("Democratic Party")) unresolved.push(slug);
        continue;
      }
      if (slug === "republican") {
        if (!validNames.has("Republican Party")) unresolved.push(slug);
        continue;
      }
      const name = SLUG_TO_NAME[slug];
      if (!name) {
        unresolved.push(`${slug} (no SLUG_TO_NAME entry)`);
        continue;
      }
      if (name === "Independent" || name === "Speaker") continue;
      if (!validNames.has(name)) {
        unresolved.push(`${slug} → "${name}" (not in 1953-preset party roster)`);
      }
    }
    expect(
      unresolved,
      `unresolved party slugs in 1953-preset:\n  ${unresolved.join("\n  ")}`
    ).toEqual([]);
  });

  // 2023-default resolves cleanly now that the parties that existed by then carry
  // it in `validForPresets`. It shares 2019's chamber arrays via getPresetSeats'
  // `default:` branch, so every slug in it is a 2019-era slug.
  it("2023-default: every party slug in getPresetSeats resolves to a seeded preset-valid party or is whitelisted independent", () => {
    const validNames = partyNamesForPreset("2023-default");
    const unresolved: string[] = [];
    for (const slug of slugsInPreset("2023-default")) {
      if (INDEPENDENT_SLUGS.has(slug)) continue;
      if (slug === "democrat" || slug === "republican") continue; // resolve via the regex fallback
      const name = SLUG_TO_NAME[slug];
      if (!name) {
        unresolved.push(`${slug} (no SLUG_TO_NAME entry)`);
        continue;
      }
      if (name === "Independent" || name === "Speaker") continue;
      if (!validNames.has(name)) unresolved.push(`${slug} -> "${name}"`);
    }
    expect(unresolved).toEqual([]);
  });

  // ── 1999/2007: a RESIDUAL DEFECT, pinned rather than asserted away ─────────
  //
  // `getPresetSeats` has no case for these two, so they fall through its
  // `default:` branch and receive the entire 2020 chamber roster — 1,004 seats
  // byte-identical to 2019-default. That fallback now records itself (see
  // recordPresetFallback), so a seed run says so instead of looking authored.
  //
  // Widening `validForPresets` for the parties that DID exist by then — LDP
  // (1955), Kōmeitō (1964), the Greens (merged 1993) — took this from 8 slugs
  // across 379 seats down to 5 across 128. The five that remain are parties that
  // genuinely postdate the era: AfD 2013, Die Linke June 2007 (too late to seat
  // a 2007 chamber), Ishin 2012, CDP 2017, DPFP 2018. Their seats are
  // anachronistic DATA, not a validity bug, and the fix is authoring real
  // 1999/2007 JP and DE chambers — a historical-data task.
  //
  // Pinned so the remainder is visible and any change to it trips here.
  const RESIDUAL_UNRESOLVED = ["de_afd", "de_linke", "jp_cdp", "jp_dpfp", "jp_ishin"];

  it.each(["1999-default", "2007-default"])(
    "%s: only the genuinely-post-era JP/DE parties still fold to independent",
    (preset) => {
      const validNames = partyNamesForPreset(preset);
      const unresolved: string[] = [];
      for (const slug of slugsInPreset(preset)) {
        if (INDEPENDENT_SLUGS.has(slug)) continue;
        if (slug === "democrat" || slug === "republican") continue;
        const name = SLUG_TO_NAME[slug];
        if (!name) {
          unresolved.push(slug);
          continue;
        }
        if (name === "Independent" || name === "Speaker") continue;
        if (!validNames.has(name)) unresolved.push(slug);
      }
      expect([...new Set(unresolved)].sort()).toEqual(RESIDUAL_UNRESOLVED);
    }
  );

  it("1991-default includes de_spd (regression: missing slug silently folded to independent)", () => {
    expect(SLUG_TO_NAME).toHaveProperty("de_spd");
    expect(SLUG_TO_NAME.de_spd).toBe("Sozialdemokratische Partei Deutschlands");
  });

  it("1991-default includes BR slugs for the 1991-only roster", () => {
    for (const slug of [
      "br_pmdb",
      "br_pfl",
      "br_pdt",
      "br_pds",
      "br_ptb",
      "br_prn",
      "br_psb",
      "br_pcdob",
    ]) {
      expect(SLUG_TO_NAME[slug], `${slug} missing in SLUG_TO_NAME`).toBeTruthy();
    }
  });

  it("1991-default includes IE slugs for the 1991-only roster", () => {
    for (const slug of ["ie_ff", "ie_fg", "ie_labour", "ie_wp", "ie_pd"]) {
      expect(SLUG_TO_NAME[slug], `${slug} missing in SLUG_TO_NAME`).toBeTruthy();
    }
  });

  it("br_other and ie_ind are explicitly whitelisted as independent (avoids fallback warnings)", () => {
    expect(INDEPENDENT_SLUGS.has("br_other")).toBe(true);
    expect(INDEPENDENT_SLUGS.has("ie_ind")).toBe(true);
  });
});

describe("buildOfficeType — president", () => {
  it("maps a president HistoricalSeat to a president office", () => {
    expect(buildOfficeType({ state: "NG", officeType: "president", party: "ng_sdp" })).toEqual({
      type: "president",
    });
  });
  it("maps a vicePresident HistoricalSeat to a vicePresident office", () => {
    expect(
      buildOfficeType({ state: "US", officeType: "vicePresident", party: "republican" })
    ).toEqual({ type: "vicePresident" });
  });
  it("still maps governor/house as before", () => {
    expect(buildOfficeType({ state: "NG", officeType: "governor", party: "ng_sdp" })).toEqual({
      type: "governor",
      state: "NG",
    });
  });
});

describe("1953-default US executive seed", () => {
  it("seeds exactly one Republican US president + one Republican US vice president", () => {
    const seats = getPresetSeats("1953-default");
    const presidents = seats.filter((s) => s.officeType === "president" && s.state === "US");
    const vps = seats.filter((s) => s.officeType === "vicePresident" && s.state === "US");
    // The 1952 landslide winner takes office: a 1953 world must start with a
    // Republican executive, not a vacant/NPP-appointed one. Names are
    // procedurally generated (no authored historical person).
    expect(presidents).toEqual([{ state: "US", officeType: "president", party: "republican" }]);
    expect(vps).toEqual([{ state: "US", officeType: "vicePresident", party: "republican" }]);
  });

  it("no other preset seeds a US president (democracies-start-vacant is preserved elsewhere)", () => {
    for (const preset of ["1979-default", "1991-default", "2019-default"]) {
      const seats = getPresetSeats(preset);
      expect(
        seats.filter((s) => s.officeType === "president" || s.officeType === "vicePresident"),
        `${preset} should not seed an executive`
      ).toEqual([]);
    }
  });
});

describe("1953-default BR executive seed", () => {
  it("seeds exactly one PTB Brazilian president (generic NPP, no authored name)", () => {
    const seats = getPresetSeats("1953-default");
    const presidents = seats.filter((s) => s.officeType === "president" && s.state === "BR");
    // PTB ticket won the 1950 presidential election; seat is party-only so
    // seedFromSeats invents a fictional name like every other officeholder.
    expect(presidents).toEqual([{ state: "BR", officeType: "president", party: "br_ptb" }]);
    expect(presidents[0]).not.toHaveProperty("name");
  });
});
