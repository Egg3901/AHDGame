import { describe, expect, it } from "vitest";
import { getAustria1953MacroCountry } from "@/lib/world/macro";
import {
  DEFAULT_SPHERE_BOUNDS,
  applySponsorIntent,
  decideNppSponsorIntent,
  getAustria1953SphereMembership,
  isEligibleSphereSponsor,
  isSphereSponsorDecisionTurn,
  listEligibleSphereSponsors,
  processSphereSponsorTick,
  routeMacroContributionThroughSpheres,
  sphereSponsorTickBucket,
  SPHERE_SPONSOR_TICK_INTERVAL,
  type SphereMembership,
} from "./index";

function commodityTotal(contribution: {
  byCommodity: Partial<Record<string, { supply: number; demand: number }>>;
}): number {
  return Object.values(contribution.byCommodity).reduce(
    (sum, bal) => sum + (bal?.supply ?? 0) + (bal?.demand ?? 0),
    0
  );
}

describe("spheres: NPP/player sponsor management (#3718)", () => {
  describe("preset eligibility matrix", () => {
    it("lists great-power sponsors for 1953 and excludes DDR", () => {
      const sponsors = listEligibleSphereSponsors("1953-default");
      expect(sponsors).toEqual(expect.arrayContaining(["US", "UK", "RU", "FR", "CN"]));
      expect(sponsors).not.toContain("DD");
      expect(isEligibleSphereSponsor("1953-default", "US")).toBe(true);
      expect(isEligibleSphereSponsor("1953-default", "RU")).toBe(true);
      expect(isEligibleSphereSponsor("1953-default", "DD")).toBe(false);
    });

    it("keeps DDR non-sponsoring in 1979 as well", () => {
      expect(isEligibleSphereSponsor("1979-default", "DD")).toBe(false);
      expect(isEligibleSphereSponsor("1979-default", "US")).toBe(true);
      expect(listEligibleSphereSponsors("1979-default")).not.toContain("DD");
    });

    it("is independent of human control — eligibility does not flip with controller", () => {
      // Same matrix answer whether the country would be player- or NPP-run.
      expect(isEligibleSphereSponsor("1953-default", "US")).toBe(true);
      expect(isEligibleSphereSponsor("1953-default", "DD")).toBe(false);
      expect(() =>
        applySponsorIntent({
          membership: getAustria1953SphereMembership(),
          sponsorId: "DD",
          intent: "court",
          controller: "npp",
          turn: 1,
        })
      ).toThrow(/not an eligible sphere sponsor/);
      expect(() =>
        applySponsorIntent({
          membership: getAustria1953SphereMembership(),
          sponsorId: "DD",
          intent: "court",
          controller: "player",
          turn: 1,
        })
      ).toThrow(/not an eligible sphere sponsor/);
    });
  });

  describe("court / support / retain / lose relationship drift", () => {
    it("courts a new member with a weak proposed relationship (no teleport)", () => {
      const base = getAustria1953SphereMembership();
      const membership: SphereMembership = {
        ...base,
        relationships: base.relationships.filter((r) => r.sponsorId !== "FR"),
      };
      const { membership: next, decision } = applySponsorIntent({
        membership,
        sponsorId: "FR",
        intent: "court",
        controller: "npp",
        turn: 7,
      });
      const fr = next.relationships.find((r) => r.sponsorId === "FR")!;
      expect(fr.alignment).toBeGreaterThan(0);
      expect(fr.alignment).toBeLessThan(0.25);
      expect(fr.treatyState).toBe("proposed");
      expect(decision.intent).toBe("court");
      expect(next.primarySphereId).toBe("US");
    });

    it("supports an existing primary by drifting integration up, leaving alignment alone", () => {
      const membership = getAustria1953SphereMembership();
      const before = membership.relationships.find((r) => r.sponsorId === "US")!;
      const { membership: next, decision } = applySponsorIntent({
        membership,
        sponsorId: "US",
        intent: "support",
        controller: "npp",
        turn: 1,
      });
      const after = next.relationships.find((r) => r.sponsorId === "US")!;
      // Alignment is owned by the alignment turn phase, which derives it from
      // Cold War pole shares. A sponsor intent buys entanglement, not sympathy.
      expect(after.alignment).toBe(before.alignment);
      expect(decision.alignmentDelta).toBe(0);
      expect(after.integration).toBeGreaterThan(before.integration);
      expect(after.integration - before.integration).toBeLessThanOrEqual(0.05);
      expect(next.primarySphereId).toBe("US");
    });

    it("retains a contested primary without instantly flipping rivals away", () => {
      const membership = getAustria1953SphereMembership();
      const contested: SphereMembership = {
        ...membership,
        relationships: membership.relationships.map((r) =>
          r.sponsorId === "RU"
            ? { ...r, alignment: 0.44, integration: 0.2 }
            : r.sponsorId === "US"
              ? { ...r, alignment: 0.45, integration: 0.2 }
              : r
        ),
      };
      expect(decideNppSponsorIntent(contested, "US")).toBe("retain");
      const { membership: next } = applySponsorIntent({
        membership: contested,
        sponsorId: "US",
        intent: "retain",
        controller: "npp",
        turn: 1,
      });
      expect(next.primarySphereId).toBe("US");
      const us = next.relationships.find((r) => r.sponsorId === "US")!;
      // Retaining defends the primary and deepens integration; it does not buy
      // back alignment, so a nation drifting away keeps drifting.
      expect(us.alignment).toBe(0.45);
      expect(us.integration).toBeGreaterThan(0.2);
    });

    it("loses influence through decay and can drop primary after sustained margin", () => {
      // Weak secondary US (RU already primary) — NPP chooses lose, not retain.
      let membership: SphereMembership = {
        ...getAustria1953SphereMembership(),
        primarySphereId: "RU",
        relationships: getAustria1953SphereMembership().relationships.map((r) =>
          r.sponsorId === "US"
            ? { ...r, alignment: 0.15, integration: 0.08, treatyState: "suspended" }
            : r.sponsorId === "RU"
              ? { ...r, alignment: 0.5, integration: 0.3 }
              : r
        ),
      };
      expect(decideNppSponsorIntent(membership, "US")).toBe("lose");

      for (let i = 0; i < 4; i++) {
        membership = applySponsorIntent({
          membership,
          sponsorId: "US",
          intent: "lose",
          controller: "npp",
          turn: i + 1,
        }).membership;
      }

      const us = membership.relationships.find((r) => r.sponsorId === "US")!;
      // Disengaging withdraws investment. Alignment stays where the alignment
      // phase last put it — abandoning a client does not change how the client
      // feels, only what it is getting.
      expect(us.alignment).toBe(0.15);
      expect(us.integration).toBeLessThan(0.08);
      expect(["suspended", "none"]).toContain(us.treatyState);
      expect(membership.primarySphereId).toBe("RU");
    });

    it("is deterministic for the same membership and intent", () => {
      const membership = getAustria1953SphereMembership();
      const a = applySponsorIntent({
        membership,
        sponsorId: "RU",
        intent: "court",
        controller: "npp",
        turn: 3,
      });
      const b = applySponsorIntent({
        membership,
        sponsorId: "RU",
        intent: "court",
        controller: "npp",
        turn: 3,
      });
      expect(b).toEqual(a);
    });
  });

  describe("NPP cadence", () => {
    it("uses a six-turn staggered bucket schedule", () => {
      expect(SPHERE_SPONSOR_TICK_INTERVAL).toBe(6);
      const bucket = sphereSponsorTickBucket("US");
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(6);

      const tickTurns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter((t) =>
        isSphereSponsorDecisionTurn(t, "US")
      );
      expect(tickTurns.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < tickTurns.length; i++) {
        expect(tickTurns[i]! - tickTurns[i - 1]!).toBe(6);
      }
      expect(isSphereSponsorDecisionTurn(0, "US")).toBe(false);
    });

    it("skips off-cadence NPP sponsors and acts on cadence", () => {
      const membership = getAustria1953SphereMembership();
      const off = processSphereSponsorTick({
        turn: 2,
        memberships: [membership],
        sponsorIds: ["US"],
      });
      const onTurn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((t) =>
        isSphereSponsorDecisionTurn(t, "US")
      )!;
      const on = processSphereSponsorTick({
        turn: onTurn,
        memberships: [membership],
        sponsorIds: ["US"],
      });

      if (!isSphereSponsorDecisionTurn(2, "US")) {
        expect(off.decisions).toHaveLength(0);
        expect(off.skippedSponsors).toContain("US");
      }
      expect(on.decisions.length).toBeGreaterThan(0);
      expect(on.decisions.every((d) => d.controller === "npp")).toBe(true);
      expect(on.decisions.every((d) => d.sponsorId === "US")).toBe(true);
    });

    it("is deterministic across identical tick inputs", () => {
      const membership = getAustria1953SphereMembership();
      const turn = [1, 2, 3, 4, 5, 6, 7].find((t) => isSphereSponsorDecisionTurn(t, "RU")) ?? 1;
      const a = processSphereSponsorTick({
        turn,
        memberships: [membership],
        sponsorIds: ["RU"],
      });
      const b = processSphereSponsorTick({
        turn,
        memberships: [membership],
        sponsorIds: ["RU"],
      });
      expect(b).toEqual(a);
    });
  });

  describe("player-controlled sponsor parity", () => {
    it("exposes the same applySponsorIntent surface for player controllers", () => {
      const membership = getAustria1953SphereMembership();
      const npp = applySponsorIntent({
        membership,
        sponsorId: "UK",
        intent: "support",
        controller: "npp",
        turn: 5,
      });
      const player = applySponsorIntent({
        membership,
        sponsorId: "UK",
        intent: "support",
        controller: "player",
        turn: 5,
      });
      expect(player.membership).toEqual(npp.membership);
      // Compare integration, not alignment: alignment no longer moves on an
      // intent, so asserting parity on it would pass whatever the code did.
      expect(player.decision.integrationDelta).toBe(npp.decision.integrationDelta);
      expect(player.decision.integrationDelta).not.toBe(0);
      expect(player.decision.controller).toBe("player");
      expect(npp.decision.controller).toBe("npp");
    });

    it("skips player-controlled sponsors in the NPP cadence tick", () => {
      const membership = getAustria1953SphereMembership();
      const turn = [1, 2, 3, 4, 5, 6, 7].find((t) => isSphereSponsorDecisionTurn(t, "US")) ?? 1;
      const result = processSphereSponsorTick({
        turn,
        memberships: [membership],
        sponsorIds: ["US"],
        controllerBySponsor: new Map([["US", "player"]]),
      });
      expect(result.decisions).toHaveLength(0);
      expect(result.skippedSponsors).toContain("US");
    });
  });

  describe("no duplicate primary benefits (regression #3717)", () => {
    it("keeps secondary market share at zero after sponsor support drift", () => {
      const austria = getAustria1953MacroCountry();
      let membership = getAustria1953SphereMembership();
      membership = applySponsorIntent({
        membership,
        sponsorId: "RU",
        intent: "court",
        controller: "npp",
        turn: 1,
      }).membership;
      membership = applySponsorIntent({
        membership,
        sponsorId: "US",
        intent: "support",
        controller: "player",
        turn: 1,
      }).membership;

      const routed = routeMacroContributionThroughSpheres(
        austria.contribution,
        membership,
        DEFAULT_SPHERE_BOUNDS
      );
      const primary = routed.allocations.find((a) => a.isPrimary)!;
      const secondaries = routed.allocations.filter((a) => !a.isPrimary);
      expect(primary.share).toBe(1);
      expect(secondaries.every((s) => s.share === 0)).toBe(true);
      expect(commodityTotal(routed.marketContribution)).toBe(commodityTotal(austria.contribution));
    });
  });
});
