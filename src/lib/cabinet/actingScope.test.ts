import { describe, expect, it } from "vitest";
import {
  ACTING_TENURE_TURNS,
  CABINET_ROUTE_CAPABILITIES,
  assertActingAllowed,
} from "./actingScope";

describe("ACTING_TENURE_TURNS", () => {
  it("is 24 turns", () => {
    expect(ACTING_TENURE_TURNS).toBe(24);
  });
});

describe("assertActingAllowed", () => {
  it("allows a confirmed holder every capability", () => {
    const member = { acting: false };
    expect(assertActingAllowed(member, "policyStance").ok).toBe(true);
    expect(assertActingAllowed(member, "personnel").ok).toBe(true);
    expect(assertActingAllowed(member, "strategicCommitment").ok).toBe(true);
    expect(assertActingAllowed(member, "capitalProject").ok).toBe(true);
    expect(assertActingAllowed(member, "operational").ok).toBe(true);
  });

  it("allows an acting holder operational actions", () => {
    expect(assertActingAllowed({ acting: true }, "operational").ok).toBe(true);
  });

  it("refuses an acting holder the four restricted capabilities", () => {
    for (const capability of [
      "policyStance",
      "personnel",
      "strategicCommitment",
      "capitalProject",
    ] as const) {
      const result = assertActingAllowed({ acting: true }, capability);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses with a 403 and copy free of dashes", async () => {
    const result = assertActingAllowed({ acting: true }, "policyStance");
    if (result.ok) throw new Error("expected refusal");
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error).not.toMatch(/[–—]/);
  });

  it("treats a null or non-acting member as unrestricted", () => {
    expect(assertActingAllowed(null, "policyStance").ok).toBe(true);
    expect(assertActingAllowed({}, "policyStance").ok).toBe(true);
  });

  it("exempts admins, who act on seats they do not hold", () => {
    // Every cabinet route admits a non-holding admin. The caretaker rule binds
    // the caretaker, not the operator, so an admin must not inherit the limit
    // merely because the seat happens to be acting-held.
    for (const capability of [
      "policyStance",
      "personnel",
      "strategicCommitment",
      "capitalProject",
    ] as const) {
      expect(assertActingAllowed({ acting: true }, capability, { isAdmin: true }).ok).toBe(true);
    }
  });
});

describe("CABINET_ROUTE_CAPABILITIES", () => {
  it("blocks policy stance levers", () => {
    expect(CABINET_ROUTE_CAPABILITIES["setting"]).toBe("policyStance");
    expect(CABINET_ROUTE_CAPABILITIES["allocation"]).toBe("policyStance");
  });

  it("blocks personnel levers", () => {
    expect(CABINET_ROUTE_CAPABILITIES["generals"]).toBe("personnel");
    expect(CABINET_ROUTE_CAPABILITIES["generals/[characterId]"]).toBe("personnel");
  });

  it("blocks irreversible national commitments", () => {
    expect(CABINET_ROUTE_CAPABILITIES["doctrine/adopt"]).toBe("strategicCommitment");
    expect(CABINET_ROUTE_CAPABILITIES["nuclear/adopt"]).toBe("strategicCommitment");
    expect(CABINET_ROUTE_CAPABILITIES["nuclear/test"]).toBe("strategicCommitment");
  });

  it("blocks new capital commitments but allows funding a running project", () => {
    expect(CABINET_ROUTE_CAPABILITIES["estates/open"]).toBe("capitalProject");
    expect(CABINET_ROUTE_CAPABILITIES["infra/start"]).toBe("capitalProject");
    expect(CABINET_ROUTE_CAPABILITIES["estates/[estateId]/fund"]).toBe("operational");
    expect(CABINET_ROUTE_CAPABILITIES["infra/[projectId]/funding"]).toBe("operational");
  });

  it("allows the operational tier", () => {
    for (const key of [
      "military/recruit",
      "military/[unitId]/posture",
      "formations",
      "theaters",
      "commands",
      "battle/declare",
      "manpower",
      "order",
    ]) {
      expect(CABINET_ROUTE_CAPABILITIES[key]).toBe("operational");
    }
  });
});
