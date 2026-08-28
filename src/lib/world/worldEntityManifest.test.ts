import { describe, expect, it } from "vitest";
import {
  defineWorldEntityPresetManifest,
  getWorldEntityOrThrow,
  getWorldEntityPresetManifest,
  type WorldEntityManifestEntry,
} from "./worldEntityManifest";

function validEntry(overrides: Partial<WorldEntityManifestEntry> = {}): WorldEntityManifestEntry {
  return {
    entityId: "XX",
    presetId: "1953-default",
    displayName: "Example",
    status: "sovereign",
    region: "europe",
    simulationTier: "historical-presence",
    economicArchetype: "none",
    sphere: { canSponsor: false, relationships: [] },
    lifecycle: { transitionRuleIds: [] },
    recognition: { status: "widely-recognized" },
    un: { state: "ineligible" },
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: ["Not a full simulation."],
      flavorGaps: [],
    },
    legacyAccess: "hidden",
    legacyStatus: "coming-soon",
    ...overrides,
  };
}

describe("world entity manifest", () => {
  it("classifies current Cold War countries without changing their legacy access seam", () => {
    expect(getWorldEntityOrThrow("1953-default", "UK")).toMatchObject({
      simulationTier: "full-autonomous",
      legacyAccess: "player",
      readiness: { autonomous: "ready", player: "ready" },
    });
    expect(getWorldEntityOrThrow("1953-default", "FR")).toMatchObject({
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
      readiness: { autonomous: "ready", player: "blocked" },
    });
    expect(getWorldEntityOrThrow("1953-default", "FR").tierReclassification).toBeUndefined();
    expect(getWorldEntityOrThrow("1953-default", "NG")).toMatchObject({
      status: "sovereign",
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
      readiness: { autonomous: "ready", player: "ready" },
      un: { state: "eligible", expectedAdmissionYear: 1960 },
      recognition: {
        status: "widely-recognized",
        notes: expect.stringMatching(/self-governing|independence/i),
      },
    });
    expect(getWorldEntityOrThrow("1953-default", "NG").parentEntityId).toBeUndefined();
  });

  it("marks Cold War great powers as sphere sponsors and DDR as non-sponsoring", () => {
    expect(getWorldEntityOrThrow("1953-default", "US").sphere.canSponsor).toBe(true);
    expect(getWorldEntityOrThrow("1953-default", "RU").sphere.canSponsor).toBe(true);
    expect(getWorldEntityOrThrow("1953-default", "UK").sphere.canSponsor).toBe(true);
    expect(getWorldEntityOrThrow("1953-default", "DD").sphere.canSponsor).toBe(false);
    expect(getWorldEntityOrThrow("1979-default", "DD").sphere.canSponsor).toBe(false);
    expect(getWorldEntityOrThrow("1979-default", "US").sphere.canSponsor).toBe(true);
  });

  it("classifies Austria as full-autonomous economy-preview, keeping its occupation-era sphere flavor (#3791)", () => {
    // AT was originally a sphere-macro NPC oracle with no CountryId, but
    // bootstrapGameWorld/seedEconTierRosters build it out exactly like its
    // FR/IT/ES/SE/TR siblings (real states, parties, NPP incumbents) — the
    // manifest now matches that, so `countryGameStates.status` resolves to
    // "beta" instead of silently freezing AT's legislature forever.
    const austria = getWorldEntityOrThrow("1953-default", "AT");
    expect(austria).toMatchObject({
      entityId: "AT",
      countryId: "AT",
      displayName: "Austria",
      simulationTier: "full-autonomous",
      economicArchetype: "market",
      legacyAccess: "economy-preview",
      legacyStatus: "beta",
      readiness: { autonomous: "ready", player: "blocked" },
      sphere: { primarySphereId: "US", canSponsor: false },
    });
    // Occupation-era sphere flavor is preserved untouched by the promotion.
    expect(austria.sphere.relationships).toHaveLength(3);
    expect(austria.sphere.relationships.every((r) => r.treatyState === "active")).toBe(true);
  });

  it("classifies the European 1953 Tier-1 economy roster as full-autonomous", () => {
    expect(getWorldEntityOrThrow("1953-default", "FI")).toMatchObject({
      countryId: "FI",
      simulationTier: "full-autonomous",
      economicArchetype: "market",
      legacyAccess: "economy-preview",
      legacyStatus: "beta",
    });
    expect(getWorldEntityOrThrow("1953-default", "GR")).toMatchObject({
      countryId: "GR",
      simulationTier: "full-autonomous",
      economicArchetype: "market",
      legacyAccess: "economy-preview",
      legacyStatus: "beta",
    });
    // Ireland is non-playable, but its investable sectors require economy-preview access.
    expect(getWorldEntityOrThrow("1953-default", "IE")).toMatchObject({
      countryId: "IE",
      simulationTier: "full-autonomous",
      economicArchetype: "market",
      legacyAccess: "economy-preview",
      legacyStatus: "beta",
      readiness: { autonomous: "ready", player: "blocked" },
    });
    // FR/IT/SE/TR re-promoted to full-autonomous economy-preview (#3723).
    for (const entityId of ["FR", "IT", "SE", "TR"] as const) {
      expect(getWorldEntityOrThrow("1953-default", entityId)).toMatchObject({
        countryId: entityId,
        simulationTier: "full-autonomous",
        economicArchetype: "market",
        legacyAccess: "economy-preview",
        readiness: { autonomous: "ready", player: "blocked" },
      });
      expect(getWorldEntityOrThrow("1953-default", entityId).tierReclassification).toBeUndefined();
    }
    // ES is the inverse case (owner decision, 2026-07-28): demoted from
    // full-autonomous to sphere-macro for 1953-default ONLY — Franco's
    // dictatorship never holds a legislative election in this preset. It
    // keeps its countryId (like IE) rather than becoming an abstract NPC.
    expect(getWorldEntityOrThrow("1953-default", "ES")).toMatchObject({
      countryId: "ES",
      simulationTier: "sphere-macro",
      economicArchetype: "market",
      legacyAccess: "hidden",
      readiness: { autonomous: "blocked", player: "blocked" },
    });
    expect(getWorldEntityOrThrow("1953-default", "PL")).toMatchObject({
      countryId: "PL",
      simulationTier: "full-autonomous",
      economicArchetype: "planned",
      legacyAccess: "economy-preview",
    });
    expect(getWorldEntityOrThrow("1953-default", "YU")).toMatchObject({
      countryId: "YU",
      simulationTier: "full-autonomous",
      economicArchetype: "planned",
      legacyAccess: "economy-preview",
    });
    // Sphere relationships preserved from #3717 on the full-country entries.
    expect(getWorldEntityOrThrow("1953-default", "PL").sphere).toMatchObject({
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU" }],
    });
    expect(getWorldEntityOrThrow("1953-default", "YU").sphere.primarySphereId).toBe("US");
    for (const entityId of ["CS", "HU", "RO", "BG"] as const) {
      expect(getWorldEntityOrThrow("1953-default", entityId)).toMatchObject({
        countryId: entityId,
        simulationTier: "full-autonomous",
        economicArchetype: "planned",
        legacyAccess: "economy-preview",
      });
    }
  });

  it("classifies the Asian / Middle Eastern 1953 Tier-2 roster as sphere-macro", () => {
    expect(getWorldEntityOrThrow("1953-default", "JO")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "market",
      displayName: "Jordan",
    });
    expect(getWorldEntityOrThrow("1953-default", "YE")).toMatchObject({
      simulationTier: "sphere-macro",
      displayName: "North Yemen",
    });
    expect(getWorldEntityOrThrow("1953-default", "MM")).toMatchObject({
      simulationTier: "sphere-macro",
      displayName: "Burma",
    });
    expect(getWorldEntityOrThrow("1953-default", "TH")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "market",
      displayName: "Thailand",
    });
    expect(getWorldEntityOrThrow("1953-default", "IN")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "market",
      displayName: "India",
    });
    expect(getWorldEntityOrThrow("1953-default", "KP")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "planned",
      displayName: "North Korea",
    });
    expect(getWorldEntityOrThrow("1953-default", "NVN")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "planned",
      displayName: "North Vietnam",
    });
    for (const entityId of ["AF", "LA", "KH", "PK", "IR", "EG", "SA", "KR", "SVN"] as const) {
      expect(getWorldEntityOrThrow("1953-default", entityId).simulationTier).toBe("sphere-macro");
    }
  });

  it("classifies the African / American 1953 Tier-2 roster as sphere-macro", () => {
    expect(getWorldEntityOrThrow("1953-default", "ET")).toMatchObject({
      simulationTier: "sphere-macro",
      economicArchetype: "market",
      displayName: "Ethiopia",
    });
    expect(getWorldEntityOrThrow("1953-default", "ZA")).toMatchObject({
      simulationTier: "sphere-macro",
      displayName: "South Africa",
    });
    expect(getWorldEntityOrThrow("1953-default", "MX")).toMatchObject({
      simulationTier: "sphere-macro",
      displayName: "Mexico",
    });
    expect(getWorldEntityOrThrow("1953-default", "VE")).toMatchObject({
      simulationTier: "sphere-macro",
      displayName: "Venezuela",
    });
    for (const entityId of ["CU", "GT", "PA", "NI", "CL", "AR"] as const) {
      expect(getWorldEntityOrThrow("1953-default", entityId).simulationTier).toBe("sphere-macro");
    }
    expect(getWorldEntityOrThrow("1953-default", "PA").displayName).toBe("Panama");
  });

  it("keeps Japan 1953 full-autonomous while recording the player blocker", () => {
    expect(getWorldEntityOrThrow("1953-default", "JP")).toMatchObject({
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
      readiness: { autonomous: "ready", player: "blocked" },
    });
    expect(
      getWorldEntityOrThrow("1953-default", "JP").readiness.hardBlockers.some((b) =>
        b.startsWith("adminDiagnostics")
      )
    ).toBe(true);
  });

  it("adds unconfigured proposed Tier-1 entities as sphere-macro with reclassification", () => {
    expect(getWorldEntityOrThrow("1953-default", "IN")).toMatchObject({
      displayName: "India",
      simulationTier: "sphere-macro",
      legacyAccess: "hidden",
      readiness: { autonomous: "blocked", player: "blocked" },
      tierReclassification: {
        proposedTier: "full-autonomous",
        appliedTier: "sphere-macro",
      },
    });
    expect(getWorldEntityOrThrow("1953-default", "NVN").displayName).toBe("North Vietnam");
    expect(getWorldEntityOrThrow("1953-default", "SVN").displayName).toBe("South Vietnam");
  });

  it("classifies Gold Coast as a UK dependency with a Ghana independence window", () => {
    const goldCoast = getWorldEntityOrThrow("1953-default", "GC");
    expect(goldCoast).toMatchObject({
      entityId: "GC",
      displayName: "Gold Coast",
      status: "dependent",
      parentEntityId: "UK",
      simulationTier: "historical-presence",
      lifecycle: {
        earliestYear: 1954,
        expectedYear: 1957,
        latestYear: 1962,
        transitionRuleIds: ["gold-coast-to-ghana"],
      },
    });
    expect(goldCoast.countryId).toBeUndefined();
  });

  it("classifies Ghana as an emergent sphere-macro target until sovereignty", () => {
    const ghana = getWorldEntityOrThrow("1953-default", "GH");
    expect(ghana).toMatchObject({
      entityId: "GH",
      displayName: "Ghana",
      status: "emergent",
      simulationTier: "sphere-macro",
      sphere: { primarySphereId: "UK", canSponsor: false },
      lifecycle: { transitionRuleIds: ["gold-coast-to-ghana"], expectedYear: 1957 },
    });
    expect(ghana.countryId).toBeUndefined();
  });

  it("preserves the admin/config fallback seam for 2019", () => {
    const manifest = getWorldEntityPresetManifest("2019-default");
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(manifest.entries.every((entry) => entry.legacyAccess === "config-fallback")).toBe(true);
  });

  it("demotes ES to sphere-macro for 1953-default ONLY, leaving every later preset untouched (owner decision, 2026-07-28)", () => {
    // Franco died 1975; Spain's first democratic election was 1977, so 1979
    // onward is a genuinely competitive democracy — only the 1953 entry
    // changes. Demoting ES across the board would break four working eras to
    // fix one.
    expect(getWorldEntityOrThrow("1953-default", "ES").simulationTier).toBe("sphere-macro");
    for (const presetId of [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
    ] as const) {
      expect(getWorldEntityOrThrow(presetId, "ES")).toMatchObject({
        countryId: "ES",
        simulationTier: "full-autonomous",
        legacyAccess: "economy-preview",
      });
    }
    // 2019-default runs off the admin/config fallback seam (every entry is
    // "config-fallback"), which resolves ES's tier from its CountryConfig
    // status rather than a hand-authored manifest entry — this asserts the
    // preserved shape rather than a specific status.
    expect(getWorldEntityOrThrow("2019-default", "ES")).toMatchObject({
      countryId: "ES",
      simulationTier: "historical-presence",
      legacyAccess: "config-fallback",
    });
  });

  it("refuses an unknown preset instead of falling back to another era", () => {
    expect(() => getWorldEntityPresetManifest("1968-default")).toThrow(
      /refusing to use another era/
    );
  });

  it("refuses an unclassified entity instead of applying a generic country", () => {
    expect(() => getWorldEntityOrThrow("1953-default", "MISSING")).toThrow(/refusing fallback/);
  });

  it("requires dependent entities to identify a parent or exceptional status", () => {
    expect(() =>
      defineWorldEntityPresetManifest("1953-default", [
        validEntry({ status: "dependent", parentEntityId: undefined }),
      ])
    ).toThrow(/missing a parent or exceptional status/);
  });

  it("accepts dependent entities with exceptional status and no parent", () => {
    expect(() =>
      defineWorldEntityPresetManifest("1953-default", [
        validEntry({
          status: "dependent",
          parentEntityId: undefined,
          exceptionalStatus: "international-zone",
        }),
      ])
    ).not.toThrow();
  });

  it("requires parent entities to exist in the same preset", () => {
    expect(() =>
      defineWorldEntityPresetManifest("1953-default", [
        validEntry({
          entityId: "DEP",
          status: "dependent",
          parentEntityId: "MISSING_PARENT",
        }),
      ])
    ).toThrow(/parent MISSING_PARENT is not in preset/);
  });

  it("requires player-ready entities to be autonomous-ready and full-autonomous", () => {
    expect(() =>
      defineWorldEntityPresetManifest("1953-default", [
        validEntry({
          readiness: {
            autonomous: "blocked",
            player: "ready",
            hardBlockers: [],
            flavorGaps: [],
          },
        }),
      ])
    ).toThrow(/autonomous-ready and full-autonomous/);
  });

  it("validates relationship bounds", () => {
    expect(() =>
      defineWorldEntityPresetManifest("1953-default", [
        validEntry({
          sphere: {
            canSponsor: false,
            relationships: [{ sponsorId: "US", alignment: 1.2, integration: 0.4, treatyIds: [] }],
          },
        }),
      ])
    ).toThrow(/invalid sphere relationship/);
  });
});
