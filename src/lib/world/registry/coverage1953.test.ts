import { describe, expect, it } from "vitest";
import { getWorldEntityOrThrow, getWorldEntityPresetManifest } from "../worldEntityManifest";
import {
  ALL_EXPECTED_1953_ENTITY_IDS,
  EXPECTED_1953_ENTITIES_BY_REGION,
  FORBIDDEN_1953_DISPLAY_NAMES,
  FORBIDDEN_NAME_ALLOWLIST_IDS,
  assert1953CoverageComplete,
  getWorldCoverageDiagnostics,
} from "./index";

describe("1953 Tier-3 world coverage registry (#3728)", () => {
  it("passes the coverage gate (omissions, parents, recognition, UN, modern names)", () => {
    expect(() => assert1953CoverageComplete("1953-default")).not.toThrow();
  });

  it("checklist has no duplicate entity IDs across regions", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ALL_EXPECTED_1953_ENTITY_IDS) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_1953_ENTITIES_BY_REGION))(
    "classifies every expected %s entity in the manifest",
    (region, expectedIds) => {
      const manifest = getWorldEntityPresetManifest("1953-default");
      const byId = new Map(manifest.entries.map((e) => [e.entityId, e]));
      const missing = expectedIds.filter((id) => !byId.has(id));
      expect(missing).toEqual([]);

      for (const id of expectedIds) {
        const entry = byId.get(id)!;
        expect(entry.region).toBe(region);
        expect(entry.recognition).toBeDefined();
        expect(entry.un).toBeDefined();
        expect(entry.simulationTier).toBeTruthy();
      }
    }
  );

  it("rejects modern-name display fallbacks on 1953 rows", () => {
    const diagnostics = getWorldCoverageDiagnostics("1953-default");
    expect(diagnostics.modernNameViolations).toEqual([]);

    const manifest = getWorldEntityPresetManifest("1953-default");
    const forbidden = new Set(FORBIDDEN_1953_DISPLAY_NAMES.map((n) => n.toLowerCase()));
    for (const entry of manifest.entries) {
      if (FORBIDDEN_NAME_ALLOWLIST_IDS.has(entry.entityId)) continue;
      expect(forbidden.has(entry.displayName.toLowerCase())).toBe(false);
    }

    expect(getWorldEntityOrThrow("1953-default", "GC").displayName).toBe("Gold Coast");
    expect(getWorldEntityOrThrow("1953-default", "CE").displayName).toBe("Ceylon");
    // HEAD Tier-2 Burma uses ISO MM (registry used BU as a Tier-3 placeholder).
    expect(getWorldEntityOrThrow("1953-default", "MM").displayName).toBe("Burma");
  });

  it("requires every dependency to have a parent or exceptional status", () => {
    const diagnostics = getWorldCoverageDiagnostics("1953-default");
    expect(diagnostics.misParented).toEqual([]);

    const manifest = getWorldEntityPresetManifest("1953-default");
    for (const entry of manifest.entries) {
      if (entry.status !== "dependent") continue;
      expect(Boolean(entry.parentEntityId) || Boolean(entry.exceptionalStatus)).toBe(true);
    }
  });

  it("keeps explicit Taiwan and Israel status records", () => {
    const taiwan = getWorldEntityOrThrow("1953-default", "TW");
    expect(taiwan).toMatchObject({
      displayName: "Taiwan",
      status: "sovereign",
      exceptionalStatus: "disputed-sovereignty",
      recognition: { status: "contested" },
      un: { state: "admitted" },
      simulationTier: "historical-presence",
    });

    const israel = getWorldEntityOrThrow("1953-default", "IL");
    expect(israel).toMatchObject({
      displayName: "Israel",
      status: "sovereign",
      recognition: { status: "partial" },
      un: { state: "admitted", memberSinceYear: 1949 },
      simulationTier: "historical-presence",
    });
  });

  it("exposes unclassified / mis-parented entities in diagnostics", () => {
    const diagnostics = getWorldCoverageDiagnostics("1953-default");
    expect(diagnostics.totalEntries).toBeGreaterThan(150);
    expect(diagnostics.byRegion.europe).toBeGreaterThan(20);
    expect(diagnostics.byRegion.africa).toBeGreaterThan(40);
    expect(diagnostics.byTier["historical-presence"]).toBeGreaterThan(100);
    expect(diagnostics.missingFromManifest).toEqual([]);
    expect(diagnostics.unmappedEntityIds.length).toBeGreaterThan(0);
  });
});
