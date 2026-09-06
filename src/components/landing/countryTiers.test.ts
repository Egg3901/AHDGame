import { describe, expect, it } from "vitest";
import {
  buildTierLookup,
  isTierInteractive,
  resolveCountryTier,
  tierForFeature,
  tierWireframeFill,
  TIER_COLORS,
  TIER_LABELS,
  TIER_ORDER,
  TIER_STROKES,
  TIER_STROKE_WIDTHS,
  type CountryTier,
} from "./countryTiers";
import {
  BATTLEGROUND_FEATURE_IDS_BY_PRESET,
  battlegroundFeatureIdsForEra,
  ECONOMIC_POWER_FEATURE_IDS_BY_PRESET,
  economicPowerFeatureIdsForEra,
} from "./countryTierRosters";
import { ERA_CONFIGS } from "./eraThemes";
import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
import {
  getWorldEntityPresetManifest,
  WORLD_ENTITY_MANIFESTS,
} from "@/lib/world/worldEntityManifest";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";

const PLAYER = { enabledForPlayers: true, economyPreview: false };
const ECON = { enabledForPlayers: false, economyPreview: true };
const NPP = { enabledForPlayers: false, economyPreview: false };

function lookupFor(eraId: keyof typeof ERA_CONFIGS) {
  return buildTierLookup(
    WORLD_COUNTRY_ISO_TO_ID,
    ERA_CONFIGS[eraId].accessMap,
    battlegroundFeatureIdsForEra(eraId),
    economicPowerFeatureIdsForEra(eraId)
  );
}

describe("country tiers — the four tiers and nothing else", () => {
  it("has exactly four tiers, with the owner's canonical names", () => {
    expect(TIER_ORDER).toEqual(["player", "economic", "battleground", "background"]);
    expect(TIER_LABELS).toEqual({
      player: "Player Nations",
      economic: "Economic Powers",
      battleground: "Battleground Nations",
      background: "Background Nations",
    });
  });

  it("defines exactly four distinct fills, and four strokes", () => {
    expect(new Set(Object.values(TIER_COLORS)).size).toBe(4);
    expect(new Set(Object.values(TIER_STROKES)).size).toBe(4);
    expect(Object.keys(TIER_STROKE_WIDTHS).sort()).toEqual([...TIER_ORDER].sort());
  });

  it("keeps Background Nations visible as land, not as ocean", () => {
    // Low contrast is the point, invisibility is not: the fill must be opaque
    // enough to read as land over the blue/black sphere beneath it.
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)$/.exec(TIER_COLORS.background)?.[1]);
    expect(alpha).toBeGreaterThan(0.35);
    // …and it must be a different colour from the ocean-side tiers.
    expect(TIER_COLORS.background).not.toBe(TIER_COLORS.economic);
  });

  it("gives every tier its own phosphor intensity in CRT wireframe mode", () => {
    const fills = TIER_ORDER.map((tier) => tierWireframeFill(tier, "#00e676"));
    expect(new Set(fills).size).toBe(4);
    for (const fill of fills) expect(fill.startsWith("#00e676")).toBe(true);
  });
});

describe("resolveCountryTier", () => {
  it("puts playable countries in Player Nations", () => {
    expect(resolveCountryTier(PLAYER)).toBe("player");
    // Playability outranks every roster — this is presentation, it must never
    // invent or withdraw a playable nation.
    expect(resolveCountryTier(PLAYER, { isBattleground: true, isEconomicPower: true })).toBe(
      "player"
    );
  });

  it("puts every other era-named country in Economic Powers", () => {
    expect(resolveCountryTier(ECON)).toBe("economic");
    expect(resolveCountryTier(NPP)).toBe("economic");
    // An era that names a country beats the 1953 battleground roster: India is
    // an Economic Power in 2019 even though it is a 1953 sphere theatre.
    expect(resolveCountryTier(ECON, { isBattleground: true })).toBe("economic");
  });

  it("falls back to the rosters, then to Background", () => {
    expect(resolveCountryTier(undefined, { isEconomicPower: true })).toBe("economic");
    expect(resolveCountryTier(undefined, { isBattleground: true })).toBe("battleground");
    expect(resolveCountryTier(undefined, { isEconomicPower: true, isBattleground: true })).toBe(
      "economic"
    );
    expect(resolveCountryTier(undefined)).toBe("background");
    expect(resolveCountryTier(null)).toBe("background");
  });
});

describe("isTierInteractive", () => {
  it("marks Background Nations inert and every other tier live", () => {
    expect(isTierInteractive("background")).toBe(false);
    for (const tier of TIER_ORDER.filter((t) => t !== "background")) {
      expect(isTierInteractive(tier)).toBe(true);
    }
  });
});

describe("buildTierLookup", () => {
  it("keys by map feature id and defaults everything else to Background", () => {
    const lookup = buildTierLookup({ "840": "US" }, { US: PLAYER });
    expect(lookup.get("840")).toBe("player");
    expect(lookup.has("999")).toBe(false);
    expect(tierForFeature(lookup, "999")).toBe("background");
    expect(tierForFeature(undefined, "840")).toBe("background");
  });

  it("adds bi: overlay keys so the split-Germany blobs tier with their owner", () => {
    const lookup = buildTierLookup({ "276": "DE" }, { DE: ECON, DD: PLAYER });
    expect(lookup.get("bi:DE")).toBe("economic");
    expect(lookup.get("bi:DD")).toBe("player");
  });

  it("lets era access override both rosters", () => {
    const lookup = buildTierLookup({ "356": "IN" }, { IN: ECON }, ["356"], []);
    expect(lookup.get("356")).toBe("economic");
  });

  it("does not enumerate Background Nations — that is the whole point", () => {
    const lookup = lookupFor("1953");
    // The 110m basemap has 175 features. The lookup only ever stores the named
    // ones; Background is the absence of an entry, so it never costs anything.
    expect([...lookup.values()]).not.toContain("background");
    expect(lookup.size).toBeLessThan(175 / 2);
  });
});

describe("1953 landing tiers", () => {
  const lookup = lookupFor("1953");
  const tierOf = (featureId: string): CountryTier => tierForFeature(lookup, featureId);

  it("colours the four playable nations as Player Nations", () => {
    expect(tierOf("840")).toBe("player"); // United States
    expect(tierOf("826")).toBe("player"); // United Kingdom
    expect(tierOf("643")).toBe("player"); // Soviet Union
    expect(lookup.get("bi:DD")).toBe("player"); // East Germany overlay blob
  });

  it("colours the Warsaw Pact bloc as Economic Powers, not just the West", () => {
    expect(tierOf("616")).toBe("economic"); // Poland
    expect(tierOf("348")).toBe("economic"); // Hungary
    expect(tierOf("642")).toBe("economic"); // Romania
    expect(tierOf("100")).toBe("economic"); // Bulgaria
    // …alongside the Western economies.
    expect(tierOf("250")).toBe("economic"); // France
    expect(tierOf("392")).toBe("economic"); // Japan
  });

  it("colours the Cold War proxy theatres as Battleground Nations", () => {
    expect(tierOf("408")).toBe("battleground"); // North Korea
    expect(tierOf("410")).toBe("battleground"); // South Korea
    expect(tierOf("364")).toBe("battleground"); // Iran
    expect(tierOf("818")).toBe("battleground"); // Egypt
    expect(tierOf("320")).toBe("battleground"); // Guatemala
    expect(tierOf("192")).toBe("battleground"); // Cuba
  });

  it("leaves the rest of the world as Background Nations", () => {
    expect(tierOf("124")).toBe("background"); // Canada
    expect(tierOf("036")).toBe("background"); // Australia
    expect(tierOf("704")).toBe("background"); // Vietnam — manifest has no proxy
  });

  it("changes nothing about what is playable", () => {
    const playable = [...lookup.entries()]
      .filter(([, tier]) => tier === "player")
      .map(([featureId]) => WORLD_COUNTRY_ISO_TO_ID[featureId] ?? featureId.replace("bi:", ""))
      .sort();
    const accessPlayable = Object.entries(ERA_CONFIGS["1953"].accessMap)
      .filter(([, access]) => access.enabledForPlayers)
      .map(([countryId]) => countryId);
    for (const countryId of playable) {
      expect(accessPlayable).toContain(countryId);
    }
  });
});

describe("roster tables stay in sync with the world entity manifest", () => {
  // The rosters are materialised copies so the landing bundle does not import
  // the manifest. These tests are the reason that copy is safe.
  const presets = Object.keys(WORLD_ENTITY_MANIFESTS);

  it("covers every preset the manifest defines", () => {
    expect(Object.keys(BATTLEGROUND_FEATURE_IDS_BY_PRESET).sort()).toEqual([...presets].sort());
    expect(Object.keys(ECONOMIC_POWER_FEATURE_IDS_BY_PRESET).sort()).toEqual([...presets].sort());
  });

  for (const presetId of presets) {
    it(`matches manifest sphere-macro / full-autonomous rosters for ${presetId}`, () => {
      const snapshot = getWorldEntityMapSnapshot(presetId);
      const manifest = getWorldEntityPresetManifest(presetId);
      const legacyById = new Map(manifest.entries.map((e) => [e.entityId, e.legacyAccess]));

      const expectedBattleground = Object.entries(snapshot.byFeatureId)
        .filter(([, item]) => item.simulationTier === "sphere-macro")
        .map(([featureId]) => featureId)
        .sort();
      const expectedEconomic = Object.entries(snapshot.byFeatureId)
        .filter(
          ([, item]) =>
            item.simulationTier === "full-autonomous" && legacyById.get(item.entityId) !== "player"
        )
        .map(([featureId]) => featureId)
        .sort();

      expect([...BATTLEGROUND_FEATURE_IDS_BY_PRESET[presetId]].sort()).toEqual(
        expectedBattleground
      );
      expect([...ECONOMIC_POWER_FEATURE_IDS_BY_PRESET[presetId]].sort()).toEqual(expectedEconomic);
    });
  }

  it("resolves era ids to preset rosters", () => {
    expect(battlegroundFeatureIdsForEra("1953")).toBe(
      BATTLEGROUND_FEATURE_IDS_BY_PRESET["1953-default"]
    );
    expect(economicPowerFeatureIdsForEra("1953")).toBe(
      ECONOMIC_POWER_FEATURE_IDS_BY_PRESET["1953-default"]
    );
    // Every supported preset resolves its roster; unknown eras remain empty.
    expect(battlegroundFeatureIdsForEra("2023")).toEqual([]);
    expect(economicPowerFeatureIdsForEra("2023")).toBe(
      ECONOMIC_POWER_FEATURE_IDS_BY_PRESET["2023-default"]
    );
    expect(economicPowerFeatureIdsForEra("2099")).toEqual([]);
  });
});
