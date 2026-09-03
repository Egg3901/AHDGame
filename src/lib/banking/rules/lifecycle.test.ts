import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_STAGES,
  lifecycleRefusal,
  lifecycleStage,
  nextStage,
  stageActions,
  stageAllows,
  stagesAllowing,
  type BankLifecycleStage,
  type LifecycleEvent,
} from "@/lib/banking/rules/lifecycle";

const base = { type: "retail" as const, status: "active" as const };

describe("lifecycleStage", () => {
  it("reads the stage from status first, then the supervisory stamps", () => {
    expect(lifecycleStage(null)).toBe("unchartered");
    expect(lifecycleStage(base)).toBe("operating");
    expect(lifecycleStage({ ...base, warningBand: "green" })).toBe("operating");
    expect(lifecycleStage({ ...base, warningBand: "amber" })).toBe("watch");
    expect(lifecycleStage({ ...base, capitalStanding: "stressed" })).toBe("watch");
    expect(lifecycleStage({ ...base, warningBand: "red" })).toBe("impaired");
    expect(lifecycleStage({ ...base, capitalStanding: "undercapitalized" })).toBe("impaired");
    expect(lifecycleStage({ ...base, undercapitalizedSinceTurn: 12 })).toBe("impaired");
    // Red beats amber, breach beats stress.
    expect(
      lifecycleStage({ ...base, warningBand: "amber", capitalStanding: "undercapitalized" })
    ).toBe("impaired");
    expect(lifecycleStage({ ...base, status: "failed" })).toBe("failed");
    expect(lifecycleStage({ ...base, status: "failed", resolutionClaimedTurn: 5 })).toBe(
      "resolving"
    );
    expect(
      lifecycleStage({
        ...base,
        status: "failed",
        resolutionClaimedTurn: 5,
        depositorsResolvedTurn: 5,
      })
    ).toBe("resolved");
    // Legacy estates resolved before the claim stamp existed still read as resolved.
    expect(lifecycleStage({ ...base, status: "failed", depositorsResolvedTurn: 5 })).toBe(
      "resolved"
    );
    expect(lifecycleStage({ ...base, status: "revoked", warningBand: "red" })).toBe("revoked");
    // A revocation in flight is a resolution, whatever the band says.
    expect(lifecycleStage({ ...base, warningBand: "amber", resolutionClaimedTurn: 9 })).toBe(
      "resolving"
    );
  });
});

describe("stage table", () => {
  it("covers every stage and every action exactly once per cell", () => {
    for (const stage of LIFECYCLE_STAGES) {
      const actions = stageActions(stage);
      expect(new Set(actions).size).toBe(actions.length);
      for (const action of actions) expect(LIFECYCLE_ACTIONS).toContain(action);
    }
    for (const action of LIFECYCLE_ACTIONS) {
      expect(stagesAllowing(action).length).toBeGreaterThan(0);
    }
  });

  it("lets a breaching bank keep serving depositors but not grow or pay out", () => {
    expect(stageAllows("impaired", "service")).toBe(true);
    expect(stageAllows("impaired", "takeDeposits")).toBe(true);
    expect(stageAllows("impaired", "borrowFromCentralBank")).toBe(true);
    expect(stageAllows("impaired", "originate")).toBe(false);
    expect(stageAllows("impaired", "distribute")).toBe(false);
    expect(stageAllows("impaired", "switchType")).toBe(false);
    expect(stageAllows("watch", "distribute")).toBe(false);
    expect(stageAllows("watch", "originate")).toBe(true);
    expect(stageAllows("operating", "distribute")).toBe(true);
  });

  it("keeps a dead bank dead", () => {
    for (const stage of ["failed", "resolving", "resolved", "revoked"] as BankLifecycleStage[]) {
      for (const action of [
        "service",
        "takeDeposits",
        "originate",
        "distribute",
        "revoke",
      ] as const) {
        expect(stageAllows(stage, action)).toBe(false);
      }
    }
    expect(stagesAllowing("claimResolution")).toEqual(["failed"]);
    expect(stagesAllowing("recoverResolution")).toEqual(["resolving"]);
    expect(stagesAllowing("windDownEstate")).toEqual(["resolved", "revoked"]);
    expect(stagesAllowing("charter")).toEqual(["unchartered", "resolved", "revoked"]);
  });

  it("explains a refusal in the player's terms", () => {
    expect(lifecycleRefusal(base, "originate")).toBeNull();
    expect(lifecycleRefusal(null, "originate")).toMatchObject({ refusal: { code: "no_charter" } });
    const impaired = lifecycleRefusal({ ...base, warningBand: "red" }, "distribute");
    expect(impaired?.refusal).toEqual({ code: "stage", stage: "impaired", action: "distribute" });
    expect(impaired?.message).toMatch(/impaired retail bank may not pay capital up/);
    const resolving = lifecycleRefusal(
      { ...base, status: "failed", resolutionClaimedTurn: 3 },
      "takeDeposits"
    );
    expect(resolving?.message).toMatch(/in resolution/);
  });
});

describe("nextStage", () => {
  it("walks the legal path and refuses the rest", () => {
    const path: Array<[BankLifecycleStage, LifecycleEvent, BankLifecycleStage]> = [
      ["unchartered", "chartered", "operating"],
      ["operating", "warned", "watch"],
      ["watch", "breached", "impaired"],
      ["impaired", "recovered", "operating"],
      ["operating", "failed", "failed"],
      ["failed", "resolution_claimed", "resolving"],
      ["resolving", "resolution_settled", "resolved"],
      ["resolved", "archived", "unchartered"],
      ["watch", "resolution_claimed", "resolving"],
      ["resolving", "revoked", "revoked"],
      ["revoked", "archived", "unchartered"],
    ];
    for (const [from, event, to] of path) expect(nextStage(from, event)).toBe(to);
    // Revocation is not a single step from service: the estate is claimed first.
    expect(nextStage("watch", "revoked")).toBeNull();
    expect(nextStage("failed", "revoked")).toBeNull();
    expect(nextStage("resolved", "resolution_claimed")).toBeNull();
    expect(nextStage("operating", "resolution_settled")).toBeNull();
    expect(nextStage("resolving", "failed")).toBeNull();
  });
});
