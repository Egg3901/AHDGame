import { describe, expect, it } from "vitest";
import {
  assertCanOpenCountryToPlayers,
  canOpenCountryToPlayers,
  evaluateCountryReadiness,
  PlayerOpenBlockedError,
  READINESS_PROFILES,
  resolveReadinessArchetypes,
  assessCountryReadiness,
  type CapabilityEvidenceMap,
  type CapabilityId,
  type ReadinessArchetype,
} from "./countryReadinessContract";

function evidenceAllPresent(overrides: CapabilityEvidenceMap = {}): CapabilityEvidenceMap {
  const all: CapabilityEvidenceMap = {};
  const ids: CapabilityId[] = [
    "fullAutonomousTier",
    "institutionsConfigured",
    "regionsAuthored",
    "partiesAuthored",
    "economyModel",
    "budgetsAuthored",
    "electionCycle",
    "cabinet",
    "billLifecycle",
    "onePartyMood",
    "plannedEconomyControls",
    "adminDiagnostics",
    "bespokeEvents",
    "artAssets",
    "wikiMaterial",
  ];
  for (const id of ids) {
    all[id] = { present: true, evidence: `${id} ok` };
  }
  return { ...all, ...overrides };
}

describe("resolveReadinessArchetypes", () => {
  it("maps presidential market countries to presidential + market", () => {
    expect(
      resolveReadinessArchetypes({
        governmentType: "presidential",
        economicArchetype: "market",
      })
    ).toEqual(["presidential", "market"]);
  });

  it("maps parliamentary monarchies to parliamentary + market", () => {
    expect(
      resolveReadinessArchetypes({
        governmentType: "parliamentaryMonarchy",
        economicArchetype: "market",
      })
    ).toEqual(["parliamentary", "market"]);
  });

  it("maps one-party planned countries to one-party + planned-economy", () => {
    expect(
      resolveReadinessArchetypes({
        governmentType: "onePartyState",
        economicArchetype: "planned",
      })
    ).toEqual(["one-party", "planned-economy"]);
  });

  it("treats disallowPrivateCorporationFounding as a planned-economy signal", () => {
    expect(
      resolveReadinessArchetypes({
        governmentType: "parliamentaryRepublic",
        economicArchetype: "market",
        disallowPrivateCorporationFounding: true,
      })
    ).toEqual(["parliamentary", "planned-economy"]);
  });
});

describe("READINESS_PROFILES per-archetype differences", () => {
  function requiredIds(archetype: ReadinessArchetype, scope: "autonomous" | "player") {
    return READINESS_PROFILES[archetype]
      .filter((r) => r.requiredFor.includes(scope) && r.kind === "mechanical")
      .map((r) => r.capabilityId)
      .sort();
  }

  it("requires billLifecycle for parliamentary autonomy but not presidential autonomy", () => {
    expect(requiredIds("parliamentary", "autonomous")).toContain("billLifecycle");
    expect(requiredIds("presidential", "autonomous")).not.toContain("billLifecycle");
    expect(requiredIds("presidential", "player")).toContain("billLifecycle");
  });

  it("requires onePartyMood only on the one-party player profile", () => {
    expect(requiredIds("one-party", "player")).toContain("onePartyMood");
    expect(requiredIds("one-party", "autonomous")).not.toContain("onePartyMood");
    expect(requiredIds("market", "player")).not.toContain("onePartyMood");
  });

  it("requires plannedEconomyControls only on the planned-economy profile", () => {
    expect(requiredIds("planned-economy", "autonomous")).toContain("plannedEconomyControls");
    expect(requiredIds("market", "autonomous")).not.toContain("plannedEconomyControls");
    expect(requiredIds("market", "autonomous")).toContain("economyModel");
  });

  it("marks flavor capabilities as non-mechanical on every profile", () => {
    for (const archetype of Object.keys(READINESS_PROFILES) as ReadinessArchetype[]) {
      const flavor = READINESS_PROFILES[archetype].filter((r) =>
        ["bespokeEvents", "artAssets", "wikiMaterial"].includes(r.capabilityId)
      );
      expect(flavor.length).toBeGreaterThan(0);
      expect(flavor.every((r) => r.kind === "flavor")).toBe(true);
    }
  });
});

describe("evaluateCountryReadiness", () => {
  it("reports autonomous safety separately from player parity", () => {
    const report = evaluateCountryReadiness({
      countryId: "JP",
      presetId: "1953-default",
      archetypes: ["parliamentary", "market"],
      evidence: evidenceAllPresent({
        // Player-only mechanical gap: cabinet missing.
        cabinet: { present: false, evidence: "No cabinet positions." },
        // Autonomous also needs cabinet for parliamentary — make billLifecycle
        // present and cabinet the only gap by using presidential+market instead.
      }),
    });

    // With parliamentary, cabinet is required for autonomous too.
    expect(report.autonomous).toBe("blocked");
    expect(report.player).toBe("blocked");
  });

  it("can be autonomous-ready while player-blocked", () => {
    const report = evaluateCountryReadiness({
      countryId: "JP",
      presetId: "1953-default",
      archetypes: ["presidential", "market"],
      evidence: evidenceAllPresent({
        adminDiagnostics: {
          present: false,
          evidence: "Admin diagnostics not registered.",
        },
        bespokeEvents: { present: false, evidence: "No events." },
      }),
    });

    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("blocked");
    expect(report.hardBlockers.map((b) => b.capabilityId)).toEqual(["adminDiagnostics"]);
    expect(report.flavorGaps.map((b) => b.capabilityId)).toContain("bespokeEvents");
  });

  it("never treats flavor gaps as hard blockers", () => {
    const report = evaluateCountryReadiness({
      countryId: "UK",
      presetId: "1953-default",
      archetypes: ["parliamentary", "market"],
      evidence: evidenceAllPresent({
        bespokeEvents: { present: false, evidence: "Missing events." },
        artAssets: { present: false, evidence: "Missing art." },
        wikiMaterial: { present: false, evidence: "Missing wiki." },
      }),
    });

    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("ready");
    expect(report.hardBlockers).toEqual([]);
    expect(report.flavorGaps.map((b) => b.capabilityId).sort()).toEqual([
      "artAssets",
      "bespokeEvents",
      "wikiMaterial",
    ]);
  });

  it("names every failed capability with its evidence in diagnostics", () => {
    const report = evaluateCountryReadiness({
      countryId: "FR",
      presetId: "1953-default",
      archetypes: ["presidential", "market"],
      evidence: evidenceAllPresent({
        cabinet: { present: false, evidence: "Cabinet roster empty." },
        billLifecycle: { present: false, evidence: "No bill phase entry." },
        artAssets: { present: false, evidence: "Placeholder art only." },
      }),
    });

    const cabinet = report.capabilities.find((c) => c.capabilityId === "cabinet");
    expect(cabinet).toMatchObject({
      status: "hard-block",
      evidence: "Cabinet roster empty.",
      label: "Cabinet positions defined",
    });
    const art = report.capabilities.find((c) => c.capabilityId === "artAssets");
    expect(art).toMatchObject({
      status: "flavor-gap",
      evidence: "Placeholder art only.",
    });
    expect(report.hardBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "cabinet",
          evidence: "Cabinet roster empty.",
        }),
        expect.objectContaining({
          capabilityId: "billLifecycle",
          evidence: "No bill phase entry.",
        }),
      ])
    );
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      countryId: "JP" as const,
      presetId: "1953-default",
      archetypes: ["parliamentary", "market"] as const,
      evidence: evidenceAllPresent({
        adminDiagnostics: { present: false, evidence: "gap" },
      }),
    };
    const results = Array.from({ length: 10 }, () => evaluateCountryReadiness(input));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

describe("assessCountryReadiness (static probes + inventory)", () => {
  it("keeps Japan 1953 autonomous-ready but player-blocked", () => {
    const report = assessCountryReadiness("JP", "1953-default");
    expect(report.archetypes).toEqual(["parliamentary", "market"]);
    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("blocked");
    expect(report.hardBlockers.map((b) => b.capabilityId)).toContain("adminDiagnostics");
    expect(report.hardBlockers[0]?.evidence.length).toBeGreaterThan(0);
    expect(report.flavorGaps.length).toBeGreaterThan(0);
  });

  it("promotes Nigeria 1953 to autonomous-ready; player-blocked on billLifecycle", () => {
    const report = assessCountryReadiness("NG", "1953-default");
    expect(report.archetypes).toEqual(["presidential", "market"]);
    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("blocked");
    expect(report.hardBlockers.map((b) => b.capabilityId)).toEqual(["billLifecycle"]);
    expect(report.flavorGaps.map((g) => g.capabilityId).sort()).toEqual([
      "artAssets",
      "bespokeEvents",
      "wikiMaterial",
    ]);
  });

  it("promotes Eastern bloc 1953 to autonomous-ready and player-ready (one-party planned)", () => {
    for (const id of ["PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      const report = assessCountryReadiness(id, "1953-default");
      expect(report.archetypes, id).toEqual(["one-party", "planned-economy"]);
      expect(report.autonomous, id).toBe("ready");
      expect(report.player, id).toBe("ready");
      expect(report.hardBlockers, id).toEqual([]);
      expect(report.flavorGaps.map((g) => g.capabilityId).sort()).toEqual([
        "artAssets",
        "bespokeEvents",
        "wikiMaterial",
      ]);
    }
  });

  it("keeps established 1953 player countries player-ready despite flavor gaps", () => {
    for (const id of ["US", "UK", "RU", "DD"] as const) {
      const report = assessCountryReadiness(id, "1953-default");
      expect(report.player, id).toBe("ready");
      expect(report.hardBlockers, id).toEqual([]);
    }
  });

  it("applies different archetype sets for market parliamentary vs planned one-party", () => {
    expect(assessCountryReadiness("UK", "1953-default").archetypes).toEqual([
      "parliamentary",
      "market",
    ]);
    expect(assessCountryReadiness("RU", "1953-default").archetypes).toEqual([
      "one-party",
      "planned-economy",
    ]);
  });
});

describe("player-open gate", () => {
  it("rejects Japan 1953 with a named hard-blocker error", () => {
    expect(() => assertCanOpenCountryToPlayers("JP", "1953-default")).toThrow(
      PlayerOpenBlockedError
    );
    try {
      assertCanOpenCountryToPlayers("JP", "1953-default");
    } catch (err) {
      expect(err).toBeInstanceOf(PlayerOpenBlockedError);
      const blocked = err as PlayerOpenBlockedError;
      expect(blocked.report.hardBlockers.map((b) => b.capabilityId)).toContain("adminDiagnostics");
      expect(blocked.message).toMatch(/adminDiagnostics/);
    }
  });

  it("allows established player-ready countries", () => {
    const result = canOpenCountryToPlayers("UK", "1953-default");
    expect(result.ok).toBe(true);
    expect(assertCanOpenCountryToPlayers("UK", "1953-default").player).toBe("ready");
  });

  it("rejects FR 1953 which lacks mechanical player wiring", () => {
    const result = canOpenCountryToPlayers("FR", "1953-default");
    expect(result.ok).toBe(false);
    expect(result.report.hardBlockers.length).toBeGreaterThan(0);
  });
});
