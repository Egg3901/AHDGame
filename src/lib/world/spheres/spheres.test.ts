import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { getAustria1953MacroCountry } from "@/lib/world/macro";
import {
  DEFAULT_SPHERE_BOUNDS,
  applySphereRoutedMacroContributions,
  assertValidSphereMembership,
  computeSphereFlows,
  explainSphereEffects,
  getAustria1953SphereMembership,
  recordSphereFlowLedger,
  resolvePrimarySponsor,
  routeMacroContributionThroughSpheres,
  type SphereBounds,
  type SphereMembership,
} from "./index";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function emptyGlobal(): Map<CommodityType, { supply: number; demand: number }> {
  const global = new Map<CommodityType, { supply: number; demand: number }>();
  for (const c of COMMODITY_TYPES) global.set(c, { supply: 100, demand: 100 });
  return global;
}

function commodityTotal(contribution: {
  byCommodity: Partial<Record<CommodityType, { supply: number; demand: number }>>;
}): number {
  return Object.values(contribution.byCommodity).reduce(
    (sum, bal) => sum + (bal?.supply ?? 0) + (bal?.demand ?? 0),
    0
  );
}

describe("spheres: Austria primary sphere (#3717)", () => {
  describe("relationship state shape", () => {
    it("stores alignment, integration, treaty state, and one primary sphere", () => {
      const membership = getAustria1953SphereMembership();

      expect(membership.entityId).toBe("AT");
      expect(membership.primarySphereId).toBe("US");
      expect(membership.relationships.length).toBeGreaterThanOrEqual(2);

      for (const rel of membership.relationships) {
        expect(rel.alignment).toBeGreaterThanOrEqual(0);
        expect(rel.alignment).toBeLessThanOrEqual(1);
        expect(rel.integration).toBeGreaterThanOrEqual(0);
        expect(rel.integration).toBeLessThanOrEqual(1);
        expect(["none", "proposed", "active", "suspended"]).toContain(rel.treatyState);
        expect(Array.isArray(rel.treatyIds)).toBe(true);
      }

      expect(resolvePrimarySponsor(membership)).toBe("US");
      expect(() => assertValidSphereMembership(membership)).not.toThrow();
    });

    it("rejects a primary that is not among relationships", () => {
      const membership: SphereMembership = {
        entityId: "AT",
        presetId: "1953-default",
        primarySphereId: "FR",
        relationships: [
          {
            sponsorId: "US",
            alignment: 0.5,
            integration: 0.4,
            treatyIds: [],
            treatyState: "active",
          },
        ],
      };
      expect(() => assertValidSphereMembership(membership)).toThrow(/not among relationships/);
    });
  });

  describe("primary-only full market benefit", () => {
    it("gives the primary the full held contribution and secondaries none by default", () => {
      const austria = getAustria1953MacroCountry();
      const membership = getAustria1953SphereMembership();
      const routed = routeMacroContributionThroughSpheres(
        austria.contribution,
        membership,
        DEFAULT_SPHERE_BOUNDS
      );

      const primary = routed.allocations.find((a) => a.isPrimary);
      const secondaries = routed.allocations.filter((a) => !a.isPrimary);

      expect(primary?.sponsorId).toBe("US");
      expect(primary?.share).toBe(1);
      expect(commodityTotal(primary!.contribution)).toBe(commodityTotal(austria.contribution));
      expect(commodityTotal(routed.marketContribution)).toBe(commodityTotal(austria.contribution));

      for (const secondary of secondaries) {
        expect(secondary.share).toBe(0);
        expect(commodityTotal(secondary.contribution)).toBe(0);
      }
    });

    it("does not duplicate full benefits when secondary market share is enabled", () => {
      const austria = getAustria1953MacroCountry();
      const membership = getAustria1953SphereMembership();
      const bounds: SphereBounds = {
        ...DEFAULT_SPHERE_BOUNDS,
        secondaryMarketShare: 0.1,
        maxTotalSecondaryMarketShare: 0.15,
      };

      const routed = routeMacroContributionThroughSpheres(austria.contribution, membership, bounds);

      const primary = routed.allocations.find((a) => a.isPrimary)!;
      const secondaryShares = routed.allocations.filter((a) => !a.isPrimary).map((a) => a.share);

      expect(primary.share).toBe(1);
      expect(secondaryShares.every((s) => s <= 0.1)).toBe(true);
      expect(secondaryShares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.15 + 1e-9);

      const full = commodityTotal(austria.contribution);
      const applied = commodityTotal(routed.marketContribution);
      // Primary full + bounded secondaries — never 3× full.
      expect(applied).toBeGreaterThan(full);
      expect(applied).toBeLessThanOrEqual(full * 1.15 + 1e-6);
      expect(applied).toBeLessThan(full * 2);
    });
  });

  describe("aid / tribute / support ledger", () => {
    it("computes bounded flows and records auditable ledger entries", async () => {
      const membership = getAustria1953SphereMembership();
      const flows = computeSphereFlows(membership, DEFAULT_SPHERE_BOUNDS);

      expect(flows.length).toBeGreaterThan(0);
      expect(flows.some((f) => f.kind === "aid")).toBe(true);
      expect(flows.some((f) => f.kind === "tribute")).toBe(true);
      expect(flows.some((f) => f.sponsorId === "US")).toBe(true);

      const db = createMockDb();
      db.collection("sphereFlowLedger");
      db.collectionMocks.sphereFlowLedger!.insertMany.mockResolvedValue({
        acknowledged: true,
        insertedCount: flows.length,
        insertedIds: {},
      });

      const entries = await recordSphereFlowLedger(db as unknown as Db, 12, flows);
      expect(entries).toHaveLength(flows.length);
      expect(db.collectionMocks.sphereFlowLedger!.insertMany).toHaveBeenCalledTimes(1);
      const inserted = db.collectionMocks.sphereFlowLedger!.insertMany.mock.calls[0]![0];
      expect(
        inserted.every((row: { turn: number; boundsApplied: boolean }) => row.turn === 12)
      ).toBe(true);
      expect(inserted.every((row: { boundsApplied: boolean }) => row.boundsApplied === true)).toBe(
        true
      );
      expect(inserted.every((row: { emitSite: string }) => row.emitSite.length > 0)).toBe(true);
    });
  });

  describe("bounds enforcement / runaway prevention", () => {
    it("caps per-kind amounts and total entity flows", () => {
      const membership = getAustria1953SphereMembership();
      const tight: SphereBounds = {
        ...DEFAULT_SPHERE_BOUNDS,
        maxAidPerTurn: 5,
        maxTributePerTurn: 4,
        maxSupportPerTurn: 3,
        maxTotalFlowsPerEntityPerTurn: 12,
      };

      const flows = computeSphereFlows(membership, tight);
      const total = flows.reduce((sum, f) => sum + f.amount, 0);

      expect(total).toBeLessThanOrEqual(12 + 1e-9);
      for (const flow of flows) {
        if (flow.kind === "aid") expect(flow.amount).toBeLessThanOrEqual(5);
        if (flow.kind === "tribute") expect(flow.amount).toBeLessThanOrEqual(4);
        if (flow.kind === "support") expect(flow.amount).toBeLessThanOrEqual(3);
      }
    });

    it("is deterministic for the same membership and bounds", () => {
      const membership = getAustria1953SphereMembership();
      const a = computeSphereFlows(membership, DEFAULT_SPHERE_BOUNDS);
      const b = computeSphereFlows(membership, DEFAULT_SPHERE_BOUNDS);
      expect(b).toEqual(a);
    });
  });

  describe("admin read model", () => {
    it("explains each active sphere effect including why contribution flows where it does", () => {
      const austria = getAustria1953MacroCountry();
      const membership = getAustria1953SphereMembership();
      const market = routeMacroContributionThroughSpheres(
        austria.contribution,
        membership,
        DEFAULT_SPHERE_BOUNDS
      );
      const flows = computeSphereFlows(membership, DEFAULT_SPHERE_BOUNDS);
      const explanations = explainSphereEffects(
        membership,
        { ...market, flows },
        DEFAULT_SPHERE_BOUNDS
      );

      expect(explanations).toHaveLength(membership.relationships.length);
      const primary = explanations.find((e) => e.isPrimary)!;
      expect(primary.sponsorId).toBe("US");
      expect(primary.marketShare).toBe(1);
      expect(primary.summary).toMatch(/full held market contribution/);
      expect(primary.bounds.maxTotalFlowsPerEntityPerTurn).toBe(
        DEFAULT_SPHERE_BOUNDS.maxTotalFlowsPerEntityPerTurn
      );

      const secondary = explanations.find((e) => e.sponsorId === "RU")!;
      expect(secondary.isPrimary).toBe(false);
      expect(secondary.marketShare).toBe(0);
      expect(secondary.summary).toMatch(/no market contribution/);
    });
  });

  describe("real macro contribution path", () => {
    let db: MockDb;

    beforeEach(() => {
      db = createMockDb();
      db.collection("macroCountries");
      db.collection("sphereFlowLedger");
      const austria = getAustria1953MacroCountry();
      const findCursor = {
        toArray: vi.fn().mockResolvedValue([austria]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);
      db.collectionMocks.sphereFlowLedger!.insertMany.mockResolvedValue({
        acknowledged: true,
        insertedCount: 1,
        insertedIds: {},
      });
    });

    it("routes Austria's held contribution into the global market via primary-sphere logic", async () => {
      const austria = getAustria1953MacroCountry();
      const global = emptyGlobal();

      const result = await applySphereRoutedMacroContributions(db as unknown as Db, global, 18);

      expect(result.entitiesRouted).toBe(1);
      expect(result.explanations.some((e) => e.isPrimary && e.sponsorId === "US")).toBe(true);
      expect(result.ledgerEntries.length).toBeGreaterThan(0);

      let changed = 0;
      for (const [commodity, bal] of Object.entries(austria.contribution.byCommodity) as [
        CommodityType,
        { supply: number; demand: number },
      ][]) {
        const g = global.get(commodity)!;
        expect(g.supply).toBe(100 + bal.supply);
        expect(g.demand).toBe(100 + bal.demand);
        changed++;
      }
      expect(changed).toBeGreaterThan(0);
    });
  });
});
