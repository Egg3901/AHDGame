import { describe, expect, it } from "vitest";
import { getWorldEntityMapSnapshot } from "./worldEntityMap";

describe("world entity map snapshot", () => {
  it("maps configured 1953 entities to the existing geographic features", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");

    expect(snapshot.byFeatureId["840"]).toMatchObject({
      entityId: "US",
      simulationTier: "full-autonomous",
      playerReady: true,
    });
    expect(snapshot.byFeatureId["566"]).toMatchObject({
      entityId: "NG",
      status: "sovereign",
      simulationTier: "full-autonomous",
      autonomousReady: true,
      playerReady: true,
    });
  });

  it("reports historical entities with no modern feature instead of hiding them", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");

    // CS/DD/YU have no exclusive Natural Earth feature: each is drawn by a
    // region shard whose pieces are owned per entity, not by a base polygon, so
    // they are correctly reported unmapped HERE.
    expect(snapshot.unmappedEntityIds).toEqual(expect.arrayContaining(["CS", "DD", "YU"]));
    // The Vietnams used to sit alongside them and no longer do: the shard
    // machinery was unavailable to them (it resolves owners from `states`, which
    // holds only full-autonomous countries), so they got authored static
    // features cut at the 17th parallel instead — see vietnamGeometry.
    expect(snapshot.unmappedEntityIds).not.toContain("NVN");
    expect(snapshot.unmappedEntityIds).not.toContain("SVN");
    expect(snapshot.byFeatureId["NVN"]).toMatchObject({ entityId: "NVN" });
    expect(snapshot.byFeatureId["SVN"]).toMatchObject({ entityId: "SVN" });
    // Austria / Finland / Greece attach modern proxies via mapFeatureIds (#3728).
    expect(snapshot.unmappedEntityIds).not.toContain("AT");
    expect(snapshot.unmappedEntityIds).not.toContain("FI");
    expect(snapshot.unmappedEntityIds).not.toContain("GR");
    expect(snapshot.byFeatureId["040"]).toMatchObject({ entityId: "AT" });
  });

  it("maps Ireland and Poland as full-autonomous onto existing features", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    expect(snapshot.byFeatureId["372"]).toMatchObject({
      entityId: "IE",
      simulationTier: "full-autonomous",
      autonomousReady: true,
      playerReady: false,
    });
    expect(snapshot.byFeatureId["616"]).toMatchObject({
      entityId: "PL",
      simulationTier: "full-autonomous",
      autonomousReady: true,
    });
  });

  it("maps re-promoted FR/IT/SE/TR as full-autonomous economy-preview", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    // France ISO 250; Italy 380; Sweden 752; Turkey 792
    expect(snapshot.byFeatureId["250"]).toMatchObject({
      entityId: "FR",
      simulationTier: "full-autonomous",
      autonomousReady: true,
      playerReady: false,
    });
    expect(snapshot.byFeatureId["380"]).toMatchObject({
      entityId: "IT",
      simulationTier: "full-autonomous",
      autonomousReady: true,
    });
    expect(snapshot.byFeatureId["752"]).toMatchObject({
      entityId: "SE",
      simulationTier: "full-autonomous",
    });
    expect(snapshot.byFeatureId["792"]).toMatchObject({
      entityId: "TR",
      simulationTier: "full-autonomous",
    });
  });

  it("maps Spain (ES) as sphere-macro for 1953 only — demoted from full-autonomous (owner decision, 2026-07-28)", () => {
    const snapshot = getWorldEntityMapSnapshot("1953-default");
    // Spain ISO 724 — Franco's dictatorship never holds a legislative
    // election in 1953-default (congresoDiputados/Senado both era-gated
    // off), so it stays an abstract Tier-2 economy here even though it
    // remains full-autonomous in every later preset.
    expect(snapshot.byFeatureId["724"]).toMatchObject({
      entityId: "ES",
      simulationTier: "sphere-macro",
    });
  });

  it("fails for an unclassified preset rather than using another era", () => {
    expect(() => getWorldEntityMapSnapshot("1968-default")).toThrow(/No world entity manifest/);
  });
});
