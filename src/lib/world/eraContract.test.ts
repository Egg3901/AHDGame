import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getPresetSeats, RESET_PRESETS } from "@/lib/constants/historicalSeats";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { getBasePolicies } from "@/lib/seeds/reference/basePolicies";
import { partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";
import { ERA_CONFIGS, type EraId } from "@/components/landing/eraThemes";
import { countriesByTier, SHIPPING_PRESETS, tierFor, type ShippingPreset } from "./eraRoster";
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
          // Not a world entity in this era at all — omitted, not disabled.
          expect(entry, `${preset}/${country}`).toBeUndefined();
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
    // Greece, Austria and Finland ship as economy-preview in 1991 with no 1991
    // national budget seed, so their economies have nothing to run on.
    "1991-default": [
      "GR (econ): budgetsAuthored",
      "AT (econ): budgetsAuthored",
      "FI (econ): budgetsAuthored",
    ],
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
   * 1999, 2007 and 2023 were never authored past the United States. Their
   * policy files (`basePolicies1999/2007/2023.ts`) carry a `us` block and
   * nothing else, and S2 shows budgets and parties are missing to match.
   *
   * ⚠️ The player-tier entries mean a reset to these presets ALREADY FAILS
   * today: `seedCountryGameStates` calls `assertCanOpenCountryToPlayers` for
   * every player country, and it throws on a hard blocker. Pre-existing, and
   * not something Plan B introduced — `probeBudgets` has always read the preset.
   */
  const SKELETON_ERA_GAPS: Partial<Record<ShippingPreset, string[]>> = {
    "1999-default": [
      "UK (player): budgetsAuthored",
      "JP (player): budgetsAuthored",
      "DE (econ): budgetsAuthored",
      "IE (econ): budgetsAuthored",
      "BR (econ): partiesAuthored, budgetsAuthored",
      "CN (econ): budgetsAuthored",
      "NG (econ): partiesAuthored, budgetsAuthored",
      "FR (econ): partiesAuthored, budgetsAuthored",
      "IT (econ): partiesAuthored, budgetsAuthored",
      "ES (econ): partiesAuthored, budgetsAuthored",
      "SE (econ): partiesAuthored, budgetsAuthored",
      "TR (econ): partiesAuthored, budgetsAuthored",
      "GR (econ): partiesAuthored, budgetsAuthored",
      "AT (econ): partiesAuthored, budgetsAuthored",
      "FI (econ): partiesAuthored, budgetsAuthored",
    ],
    "2007-default": [
      "UK (player): budgetsAuthored",
      "JP (player): budgetsAuthored",
      "DE (econ): budgetsAuthored",
      "IE (econ): budgetsAuthored",
      "BR (econ): partiesAuthored, budgetsAuthored",
      "CN (econ): budgetsAuthored",
      "NG (econ): partiesAuthored, budgetsAuthored",
      "FR (econ): partiesAuthored, budgetsAuthored",
      "IT (econ): partiesAuthored, budgetsAuthored",
      "ES (econ): partiesAuthored, budgetsAuthored",
      "SE (econ): partiesAuthored, budgetsAuthored",
      "TR (econ): partiesAuthored, budgetsAuthored",
      "GR (econ): partiesAuthored, budgetsAuthored",
      "AT (econ): partiesAuthored, budgetsAuthored",
      "FI (econ): partiesAuthored, budgetsAuthored",
    ],
    // 2023 authors budgets for the western European economy-preview set but not
    // for the UK, Japan, Germany, Ireland or China, and Brazil and Nigeria carry
    // the same 1953-gated full-autonomous promotion gap as they do in 2019.
    "2023-default": [
      "UK (player): budgetsAuthored",
      "JP (player): budgetsAuthored",
      "DE (econ): budgetsAuthored",
      "IE (econ): budgetsAuthored",
      "BR (econ): fullAutonomousTier, partiesAuthored, budgetsAuthored",
      "CN (econ): budgetsAuthored",
      "NG (econ): fullAutonomousTier, partiesAuthored, budgetsAuthored",
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
