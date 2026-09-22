import { describe, expect, it } from "vitest";
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryConfig,
  isPresidentialGovernmentType,
  type CountryId,
} from "@/lib/constants/countries";
import { getPresetSeats, RESET_PRESETS } from "@/lib/constants/historicalSeats";
import { seatCountFor, seatsForCountry } from "@/lib/constants/presetSeatGroups";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { regionBundleFor } from "@/lib/admin/seedDiagnostic/regionBundles";
import { getBasePolicies } from "@/lib/seeds/reference/basePolicies";
import { partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";
import { ERA_CONFIGS, type EraId } from "@/components/landing/eraThemes";
import {
  countriesByTier,
  isVacantChamber,
  SHIPPING_PRESETS,
  tierFor,
  vacantSeatsFor,
  type ShippingPreset,
} from "./eraRoster";
import { assessCountryReadiness } from "./countryReadinessContract";
import { getWorldEntityPresetManifest } from "./worldEntityManifest";

const eraOf = (preset: ShippingPreset): EraId => preset.slice(0, 4) as EraId;

/**
 * S6 — every consumer of era standing agrees with the roster.
 *
 * Before this, five authorities answered "what is this country in this era?"
 * independently and disagreed: the 1991 landing page advertised Germany as
 * playable while the manifest had it economy-only, and the admin reset picker
 * listed seven countries for a preset whose world contained sixteen.
 *
 * MECHANISM: pure comparison of derived consumers against `tierFor`. No DB, no
 * fallback machinery — each consumer is now computed from the roster, so these
 * assertions are about the derivation staying wired, not about hand-kept copies
 * staying in sync.
 */
describe("S6 — every roster consumer agrees with tierFor", () => {
  it("the world-entity manifest matches the roster for registered countries", () => {
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      for (const country of COUNTRY_ORDER) {
        const tier = tierFor(preset, country);
        const entry = manifest.entries.find((e) => e.countryId === country);

        if (tier === "absent") {
          // Not a LIVE world entity in this era. The one thing it may still be
          // is a dissolved record: upstream's background roster keeps a state
          // that has ceased to exist so the world remembers it did, and marks
          // it `dissolved`/`hidden` rather than deleting the row.
          //
          // ⚠ A DISSOLVED ROW IS THE ONLY ALLOWED SURVIVOR. Anything else that
          // the roster calls absent must be gone: a `sovereign` East Germany in
          // a 2019 manifest is the exact defect this sub-project removed.
          if (entry) {
            expect(entry.status, `${preset}/${country}`).toBe("dissolved");
            expect(entry.legacyAccess, `${preset}/${country}`).toBe("hidden");
          }
          continue;
        }
        const expected =
          tier === "player" ? "player" : tier === "econ" ? "economy-preview" : "hidden";
        expect(entry?.legacyAccess, `${preset}/${country}`).toBe(expected);
      }
    }
  });

  it("the landing accessMap matches the roster", () => {
    for (const preset of SHIPPING_PRESETS) {
      const config = ERA_CONFIGS[eraOf(preset)];
      for (const [country, access] of Object.entries(config.accessMap)) {
        const tier = tierFor(preset, country as CountryId);
        expect(access.enabledForPlayers, `${preset}/${country}`).toBe(tier === "player");
        expect(access.economyPreview, `${preset}/${country}`).toBe(tier === "econ");
      }
    }
  });

  it("the landing nations[].tier matches the roster", () => {
    // A SECOND display authority beside accessMap. Deriving only accessMap
    // would leave this free to drift in exactly the way S6 exists to prevent.
    for (const preset of SHIPPING_PRESETS) {
      for (const nation of ERA_CONFIGS[eraOf(preset)].nations) {
        expect(nation.tier, `${preset}/${nation.id}`).toBe(tierFor(preset, nation.id as CountryId));
      }
    }
  });

  it("the landing page never advertises a country absent from the era", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const nation of ERA_CONFIGS[eraOf(preset)].nations) {
        expect(tierFor(preset, nation.id as CountryId), `${preset}/${nation.id}`).not.toBe(
          "absent"
        );
      }
    }
  });

  it("the admin reset picker matches the roster, for presets it defines", () => {
    // Derived only for preset ids RESET_PRESETS already carries: there is no
    // 1999-default or 2007-default entry, and /api/admin/reset/presets returns
    // this array verbatim, so generating them would add two resets to the admin
    // picker as a side effect of a consistency check.
    for (const entry of RESET_PRESETS) {
      if (!(SHIPPING_PRESETS as readonly string[]).includes(entry.id)) continue;
      const preset = entry.id as ShippingPreset;
      const live = COUNTRY_ORDER.filter((c) => tierFor(preset, c) !== "absent");
      expect([...entry.countries].sort(), entry.id).toEqual([...live].sort());
    }
  });

  it("every shipping preset has a sphere-sponsor set", () => {
    // 2023-default had none, so isManifestSphereSponsor returned false for every
    // country in that preset and nothing could sponsor a sphere there.
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      expect(
        manifest.entries.some((e) => e.sphere.canSponsor),
        preset
      ).toBe(true);
    }
  });

  it("no absent country is sphere-sponsor eligible", () => {
    // Future-proofing, and currently vacuous: the eligibility sets only hold
    // US/UK/RU/FR/CN/DE/JP, none of which is absent anywhere. It exists so the
    // pairing cannot silently break when either side changes.
    for (const preset of SHIPPING_PRESETS) {
      for (const entry of getWorldEntityPresetManifest(preset).entries) {
        if (!entry.countryId || tierFor(preset, entry.countryId) !== "absent") continue;
        expect(entry.sphere.canSponsor, `${preset}/${entry.countryId}`).toBe(false);
      }
    }
  });
});

/**
 * S2 — every live country meets the contract its tier requires.
 *
 * MECHANISM: `assessCountryReadiness`, which since Plan B reads the preset in
 * its region, party and diagnostic probes. Before that it short-circuited on a
 * country-keyed expectations lookup that never consulted `presetId`, so this
 * assertion would have passed for all 19 countries holding an entry without
 * proving anything: a 2019 Russia satisfied `partiesAuthored` by asserting the
 * CPSU, whose seeds are gated to 1953 and 1979.
 *
 * ⚠️ SCOPE CORRECTION, and it is not a weakening. The design widened S2 to
 * `npp` on the reading that READINESS_PROFILES' "autonomous" scope means "can
 * run under NPP control". It does not. Its first requirement is
 * `fullAutonomousTier`, i.e. the manifest's `simulationTier` being
 * `full-autonomous`, and measured across every shipping preset that is what the
 * tiers actually are:
 *
 *     player  23 full-autonomous,  0 otherwise
 *     econ    78 full-autonomous,  4 historical-presence
 *     npp      0 full-autonomous, 50 historical-presence + 1 sphere-macro
 *
 * No `npp` country is full-autonomous anywhere, by construction: `npp` is the
 * coming-soon tier and a historical-presence entity has no parties, budgets or
 * elections to author. Asserting the autonomous contract over it demanded that
 * every coming-soon country be a fully simulated one, which is a category error
 * rather than 55 defects. The roster/manifest pairing that IS meaningful for
 * `npp` is checked below instead, so the tier keeps coverage that can fail.
 */
describe("S2 — live countries meet their tier's capability contract", () => {
  const SCOPE = { player: "player", econ: "autonomous" } as const;

  function s2Failures(preset: ShippingPreset): string[] {
    const out: string[] = [];
    for (const country of COUNTRY_ORDER) {
      const tier = tierFor(preset, country);
      if (tier !== "player" && tier !== "econ") continue;
      const scope = SCOPE[tier];

      let report;
      try {
        report = assessCountryReadiness(country, preset);
      } catch (err) {
        // A registered country with no world entity is itself the finding: the
        // roster says this era contains it and the manifest disagrees.
        out.push(`${country} (${tier}): ${(err as Error).message}`);
        continue;
      }

      if (report[scope] === "ready") continue;
      const blocking = report.capabilities
        .filter((c) => c.status === "hard-block" && c.requiredFor.includes(scope))
        .map((c) => c.capabilityId);
      out.push(`${country} (${tier}): ${blocking.join(", ")}`);
    }
    return out;
  }

  /**
   * Authored eras must be clean, with the recorded exceptions below.
   *
   * Exact equality, not a floor: a NEW gap fails, and so does a gap someone has
   * FIXED without deleting its line. That is what keeps a known-debt list from
   * decaying into a permanently red test nobody reads.
   */
  const KNOWN_GAPS: Partial<Record<ShippingPreset, string[]>> = {
    // 1991 has NO recorded gaps any more. Greece, Austria and Finland used to
    // ship as economy-preview with no 1991 national budget seed; upstream's
    // "make every seed complete" (#1669) authored them, and this list is exact
    // rather than a floor, so the fix had to be recorded here or the test would
    // have stayed red for a problem that no longer exists.
    // Brazil and Nigeria are economy-preview in the roster but modelled
    // `historical-presence` in the manifest. Pre-existing: the Tier-1 promotion
    // that makes them full-autonomous lives in
    // `apply1953Tier1MatrixAdjustments`, which returns early for any preset
    // other than 1953-default.
    "2019-default": ["BR (econ): fullAutonomousTier", "NG (econ): fullAutonomousTier"],
  };

  it.each(["1953-default", "1979-default", "1991-default", "2019-default"] as const)(
    "%s meets the contract, save for its recorded gaps",
    (preset) => {
      expect(s2Failures(preset)).toEqual(KNOWN_GAPS[preset] ?? []);
    }
  );

  /**
   * 1999, 2007 and 2023 were authored past the United States by upstream's
   * "make every seed complete" (#1669). What remains is `partiesAuthored`, plus
   * the 1953-gated full-autonomous promotion for Brazil and Nigeria.
   *
   * ⚠️ THE PLAYER-TIER BLOCK IS GONE, AND THAT IS THE HEADLINE. These lists
   * used to carry "UK (player): budgetsAuthored" and "JP (player):
   * budgetsAuthored", and `seedCountryGameStates` calls
   * `assertCanOpenCountryToPlayers` for every player country and throws on a
   * hard blocker -- so a reset to 1999, 2007 or 2023 FAILED OUTRIGHT. Upstream
   * authoring those budgets is what unblocked it. No player-tier entry survives
   * below; if one reappears, those resets are broken again.
   */
  const SKELETON_ERA_GAPS: Partial<Record<ShippingPreset, string[]>> = {
    "1999-default": [
      "BR (econ): partiesAuthored",
      "NG (econ): partiesAuthored",
      "FR (econ): partiesAuthored",
      "IT (econ): partiesAuthored",
      "ES (econ): partiesAuthored",
      "SE (econ): partiesAuthored",
      "TR (econ): partiesAuthored",
      "GR (econ): partiesAuthored",
      "AT (econ): partiesAuthored",
      "FI (econ): partiesAuthored",
    ],
    "2007-default": [
      "BR (econ): partiesAuthored",
      "NG (econ): partiesAuthored",
      "FR (econ): partiesAuthored",
      "IT (econ): partiesAuthored",
      "ES (econ): partiesAuthored",
      "SE (econ): partiesAuthored",
      "TR (econ): partiesAuthored",
      "GR (econ): partiesAuthored",
      "AT (econ): partiesAuthored",
      "FI (econ): partiesAuthored",
    ],
    // 2023 authors budgets for the western European economy-preview set but not
    // for the UK, Japan, Germany, Ireland or China, and Brazil and Nigeria carry
    // the same 1953-gated full-autonomous promotion gap as they do in 2019.
    "2023-default": [
      "BR (econ): fullAutonomousTier, partiesAuthored",
      "NG (econ): fullAutonomousTier, partiesAuthored",
    ],
  };

  it.each(["1999-default", "2007-default", "2023-default"] as const)(
    "%s is a skeleton era, and its gaps are exactly the recorded ones",
    (preset) => {
      expect(s2Failures(preset)).toEqual(SKELETON_ERA_GAPS[preset] ?? []);
    }
  );
});

/**
 * The roster tier and the manifest simulation tier must agree on what a country
 * IS. This is the coverage `npp` keeps now the capability contract no longer
 * applies to it, and unlike that contract it can actually fail: it fails if
 * someone marks a coming-soon country full-autonomous, or leaves a playable one
 * as historical presence.
 */
describe("S2b — roster tier and simulation tier agree", () => {
  it("every player country is a full-autonomous entity", () => {
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      for (const country of COUNTRY_ORDER) {
        if (tierFor(preset, country) !== "player") continue;
        const entry = manifest.entries.find((e) => e.countryId === country);
        expect(entry?.simulationTier, `${preset}/${country}`).toBe("full-autonomous");
      }
    }
  });

  it("no coming-soon country is a full-autonomous entity", () => {
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      for (const country of COUNTRY_ORDER) {
        if (tierFor(preset, country) !== "npp") continue;
        const entry = manifest.entries.find((e) => e.countryId === country);
        expect(entry?.simulationTier, `${preset}/${country}`).not.toBe("full-autonomous");
      }
    }
  });
});

/**
 * S3a — a country the era does not contain has no authored data in it.
 *
 * MECHANISM: `countriesByTier(preset, "absent")` against the authored bundles.
 * Pure; no DB.
 *
 * Absence is the assertion nothing else makes. Every other check asks whether
 * data is PRESENT; `Partial<Record<CountryId, X>>` cannot express "must be empty
 * here", which is why East German parties were still being created in worlds set
 * after reunification.
 */
describe("S3a — absent countries carry no era data", () => {
  it("seeds no party for a country the era does not contain", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const country of countriesByTier(preset, "absent")) {
        expect(partySeedsForPreset(country, preset), `${preset}/${country}`).toEqual([]);
      }
    }
  });

  it("seeds no national budget for a country the era does not contain", () => {
    for (const preset of SHIPPING_PRESETS) {
      // Widened to string: the budget configs are keyed by a narrower
      // SupportedBudgetCountryId, and the whole point here is to ask about
      // countries outside it.
      const budgeted = new Set<string>(
        getNationalBudgetSeedConfigsForPreset(preset).map((c) => String(c.countryId))
      );
      for (const country of countriesByTier(preset, "absent")) {
        expect(budgeted.has(country), `${preset}/${country}`).toBe(false);
      }
    }
  });

  it("seats no chamber for a country the era does not contain", () => {
    // Seats key on officeType rather than countryId, so match through the
    // country's own configured chamber keys.
    for (const preset of SHIPPING_PRESETS) {
      const offices = new Set(getPresetSeats(preset).map((s) => String(s.officeType)));
      for (const country of countriesByTier(preset, "absent")) {
        const legislature = COUNTRY_CONFIGS[country]?.legislature;
        const chambers = [legislature?.lowerChamber?.key, legislature?.upperChamber?.key].filter(
          (k): k is string => Boolean(k)
        );
        for (const chamber of chambers) {
          expect(offices.has(chamber), `${preset}/${country}/${chamber}`).toBe(false);
        }
      }
    }
  });
});

/**
 * S3b — no preset carries a policy block for a country it does not contain.
 *
 * MECHANISM: `getBasePolicies(preset)` against `tierFor`. It rests on every era
 * having its own policy file, which is true only since `basePolicies2019.ts` was
 * written.
 *
 * ⚠️ SCOPE, stated precisely, because the name invites overclaiming. The eleven
 * blocks leaking into 2019 split two ways, and this check sees only one of them:
 *
 *   - `su dd cs yu bal` fail on EXISTENCE. They are polities that did not exist
 *     in 2019, so `tierFor` reports them absent and this assertion catches them.
 *
 *   - `pl hu ro bg blr ukr` fail on CONTENT ONLY. Poland plainly existed in
 *     2019 and is `npp` in the roster, so it is live and this assertion passes
 *     over it. What was wrong was never the country, it was that its block came
 *     from `easternBlocPolicyConfig` and set the Leading Role Statute.
 *
 * The content half has no check here by design: it is made structurally
 * impossible by 2019 owning a policy file rather than inheriting the catch-all
 * map. The regression lock for it lives with the thing it locks, in
 * `basePolicies/legislationVacuum.test.ts` ("seeds no other era's policy block
 * in a 2019 world"), which asserts all eleven prefixes are absent from the 2019
 * output. Checking era-provenance in general needs a recorder that can express
 * older-data-reaching-a-newer-preset, and none exists.
 *
 * ⚠️ NOT `getPresetFallbacks()` either. `selectPresetBundle` has one fallback
 * target (`bundles["2019-default"]`) and records only when
 * `eraForPreset(preset) !== "2019"`, so it can structurally record only
 * 2019-data-reaching-an-older-preset. Poland's case is the reverse. The leaking
 * lane never touched the selector at all: `getBasePolicies` is a plain if/else
 * chain, and 2019 was its fall-through.
 */
describe("S3b — no preset carries a policy block for a country it lacks", () => {
  /**
   * Legislation ids are `<countryScope>_<topic>`, except for the legacy types
   * that carry no `countryScope` at all. `buildBasePolicies` attributes those to
   * the US, so their ids keep their original prefixes rather than gaining `us_`.
   */
  const US_LEGACY_PREFIXES = new Set(["resource", "senate"]);

  /** The USSR's policy blocks are keyed `su`; the world entity is `RU`. */
  const PREFIX_TO_COUNTRY: Record<string, CountryId> = { su: "RU" };

  it.each([...SHIPPING_PRESETS])("%s seeds only countries it contains", async (preset) => {
    const records = await getBasePolicies(preset);
    const prefixes = [...new Set(records.map((r) => r.legislationTypeId.split("_")[0]))];

    for (const prefix of prefixes) {
      if (US_LEGACY_PREFIXES.has(prefix)) continue;
      const countryId = PREFIX_TO_COUNTRY[prefix] ?? (prefix.toUpperCase() as CountryId);

      // A prefix that is not a CountryId at all can never be live, which is
      // exactly how `su` leaked into 2019 unnoticed for as long as it did.
      expect(
        COUNTRY_CONFIGS[countryId],
        `${preset}: policy prefix "${prefix}" is not a known country`
      ).toBeDefined();
      expect(tierFor(preset, countryId), `${preset}/${countryId}`).not.toBe("absent");
    }
  });
});

/**
 * S5 — a presidential country open to players starts with a head of state.
 *
 * MECHANISM: `seatsForCountry(preset, countryId)`. Pure, preset-local, and it
 * needs the country dimension: `officeType === "president"` alone would count
 * Brazil's president as the United States'.
 *
 * No threshold and no tolerance constant. Seeding the executive and running the
 * election engine are independent - US_EXECUTIVE_1953 records that "the
 * perpetual race spawns from canonical anchors regardless of the officeholder"
 * - so there is no reason to permit any vacancy, and a duration bound would
 * have been a magic number justifying a compromise nothing requires.
 *
 * The gap this closes, at 1 turn = 1 real hour and TURNS_PER_YEAR = 48: a 1991
 * world waited ~48 turns for the 1992 election, and a 2019 world waited ~240
 * turns - about ten real days - for 2024.
 */
describe("S5 — presidential player countries seed an executive", () => {
  /**
   * 1979 is a recorded exception, and it is NOT the same gap.
   *
   * That preset seats no US anything - its per-state 1978 results are a separate
   * historical-data task - and, decisively, the `democrat` slug has no
   * SLUG_TO_NAME entry there, so a seeded Democratic president would fold to
   * "independent" via resolvePartyId. A fake independent president is worse than
   * an empty chair, so the vacancy stands until the 1979 US party roster exists.
   */
  const AUTHORED_VACANT_EXECUTIVE = new Set(["1979-default/US"]);

  it("every presidential player country has a president in every era", () => {
    const missing: string[] = [];
    for (const preset of SHIPPING_PRESETS) {
      for (const country of COUNTRY_ORDER) {
        if (tierFor(preset, country) !== "player") continue;
        if (!isPresidentialGovernmentType(getCountryConfig(country, preset).governmentType)) {
          continue;
        }
        const seats = seatsForCountry(preset, country);
        if (!seats.some((seat) => seat.officeType === "president")) {
          missing.push(`${preset}/${country}`);
        }
      }
    }
    expect(missing.filter((m) => !AUTHORED_VACANT_EXECUTIVE.has(m))).toEqual([]);
    // The exception must stay real: seed 1979 and this line fails until deleted.
    expect(missing).toEqual([...AUTHORED_VACANT_EXECUTIVE]);
  });

  it("pairs every seeded president with a vice president where the office exists", () => {
    // A president with no VP leaves the succession line empty.
    //
    // Brazil 1953 is a recorded exception, not an oversight: its own comment
    // explains that "the 1951-54 VP sat with PSP, which is not in the 1953 BR
    // party roster". Seeding one would mean inventing a party affiliation, so
    // the gap is named here instead of being papered over.
    const AUTHORED_WITHOUT_VP = new Set(["1953-default/BR"]);
    const missing: string[] = [];
    for (const preset of SHIPPING_PRESETS) {
      for (const country of COUNTRY_ORDER) {
        const seats = seatsForCountry(preset, country);
        if (!seats.some((s) => s.officeType === "president")) continue;
        const offices = getCountryConfig(country, preset).officeTypes ?? [];
        if (!offices.some((o) => o.key === "vicePresident")) continue;
        if (seats.some((s) => s.officeType === "vicePresident")) continue;
        missing.push(`${preset}/${country}`);
      }
    }
    expect(missing.filter((m) => !AUTHORED_WITHOUT_VP.has(m))).toEqual([]);
    // The exception must stay real: if BR ever gains a VP row, delete the entry.
    expect(missing).toEqual([...AUTHORED_WITHOUT_VP]);
  });
});

/**
 * S4 — a player country's chambers agree across all three authorities.
 *
 * MECHANISM: `seatCountFor` (which needs C0's country dimension: filtering
 * `getPresetSeats` on `officeType === "senate"` counts Brazil's senators as
 * American ones) against `getCountryConfig(id, preset)`, plus the region
 * bundles for the UK.
 *
 * Reads `getCountryConfig`, NOT base `COUNTRY_CONFIGS`. That decides whether the
 * assertion is satisfiable at all: an era override can only settle a mismatch if
 * the check consults it, and three of Plan C's fixes are overrides.
 *
 * A chamber marked vacant-by-design is asserted to seat EXACTLY zero, so the
 * exemption is itself checked rather than being a hole to hide in.
 */
describe("S4 — player chambers agree with their era config", () => {
  const CHAMBERS: Partial<Record<CountryId, readonly string[]>> = {
    US: ["house", "senate"],
    UK: ["commons"],
    JP: ["shugiin", "sangiin"],
  };

  function s4Failures(preset: ShippingPreset): string[] {
    const out: string[] = [];
    for (const country of COUNTRY_ORDER) {
      if (tierFor(preset, country) !== "player") continue;
      for (const chamber of CHAMBERS[country] ?? []) {
        const seeded = seatCountFor(preset, country, chamber);
        if (isVacantChamber(preset, country, chamber)) {
          if (seeded !== 0) out.push(`${country}.${chamber}: vacant by design but seats ${seeded}`);
          continue;
        }
        const legislature = getCountryConfig(country, preset).legislature;
        const size =
          legislature?.lowerChamber?.key === chamber
            ? legislature.lowerChamber.seats
            : legislature?.upperChamber?.key === chamber
              ? legislature.upperChamber.seats
              : null;
        if (size == null) {
          out.push(`${country}.${chamber}: no chamber of that key in the config`);
          continue;
        }
        const vacant = vacantSeatsFor(preset, country, chamber);
        if (seeded + vacant !== size) {
          out.push(`${country}.${chamber}: seeded ${seeded} + vacant ${vacant} != config ${size}`);
        }
      }
    }
    return out;
  }

  /**
   * Starting state, exact-match so a FIXED gap fails too and the list cannot rot.
   * Tasks C3, C4 and C5 empty these; whatever survives is recorded debt.
   */
  const S4_KNOWN_GAPS: Partial<Record<ShippingPreset, string[]>> = {
    // 1953 US, 1991 UK and the 1991 Shugiin are FIXED by era config overrides
    // (Task C3): the seeded rosters were right and the base config was
    // era-blind, so the config moved to meet them.
    //
    // The 1991 Sangiin was the one case where BOTH sides were wrong, and it is
    // FIXED too. It is recorded here rather than deleted because the reasoning
    // that kept it open is worth keeping: the roster totalled 206 against a
    // correct 252, and bending the config down to match an incomplete roster
    // was rightly refused. What changed is that the roster was completed to 252
    // instead — see JP_SANGIIN_1989, which now also splits its two staggered
    // classes 126/126 rather than leaving the stagger implicit.
    //
    // 2027 arrived with upstream's preset and its Sangiin roster totals 247
    // against a 248-seat config. Recorded, not papered over: the same choice as
    // 1991 above. Bending the config to 247 would make the game agree with an
    // incomplete roster, and adding a 48th seat would be inventing a result.
    "2027-default": ["JP.sangiin: seeded 247 + vacant 0 != config 248"],
    // The US House (C4) and the Commons (C5) are both FIXED. Every player
    // chamber now agrees with its era config except the two above.
  };

  it.each([...SHIPPING_PRESETS])("%s", (preset) => {
    expect(s4Failures(preset)).toEqual(S4_KNOWN_GAPS[preset] ?? []);
  });

  /**
   * The third leg, and the one with real consequences in play: seats can agree
   * with the config while the regions that ELECT them sum to something else, and
   * that is what misallocates a general election.
   *
   * Pinned per era. 1991 and 2019 equal their chamber sizes exactly (650 each);
   * the older eras still disagree and are recorded so they cannot drift
   * unnoticed. 1979's 635 against a 650-seat config is the largest remaining
   * gap, and that preset seats no Commons at all.
   *
   * 1991 was 651 — the chamber the 1992 boundary review produced, in a world
   * that opens in January 1991. It is 650 now, on the 1983 boundaries actually
   * in force at the start.
   */
  const UK_DISTRICT_SUMS: Record<ShippingPreset, number> = {
    "1953-default": 625,
    "1979-default": 635,
    "1991-default": 650,
    "1999-default": 659,
    "2007-default": 646,
    "2019-default": 650,
    "2023-default": 650,
    // 2027 arrived with upstream's preset. Summed from ukRegions2027's twelve
    // houseDistricts values, not assumed from 2023: the two agree at 650 here,
    // but that is a fact about the authored bundle rather than a rule.
    "2027-default": 650,
  };

  it.each([...SHIPPING_PRESETS])("%s UK region districts", (preset) => {
    const bundle = regionBundleFor("UK", preset);
    expect(bundle, preset).not.toBeNull();
    const sum = bundle!.reduce((total, region) => total + (region.houseDistricts ?? 0), 0);
    expect(sum, preset).toBe(UK_DISTRICT_SUMS[preset]);
  });
});
