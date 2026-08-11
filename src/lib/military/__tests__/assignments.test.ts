import { describe, it, expect } from "vitest";
import {
  validateAssignments,
  isAssignedTo,
  theaterCommanderOf,
  generalLeadingUnit,
  theaterOfUnit,
  type ConflictAssignment,
} from "../assignments";

const opts = { validGenerals: new Set(["g1", "g2"]) };
const a = (over: Partial<ConflictAssignment> = {}): ConflictAssignment => ({
  theaterId: "afghan",
  generalCharacterId: "g1",
  inCharge: false,
  ...over,
});

describe("validateAssignments", () => {
  it("accepts one theater commander plus supporting generals at one conflict", () => {
    expect(
      validateAssignments(
        [a({ generalCharacterId: "g1", inCharge: true }), a({ generalCharacterId: "g2" })],
        opts
      )
    ).toBeNull();
  });

  it("rejects two theater commanders at the same conflict", () => {
    expect(
      validateAssignments(
        [
          a({ generalCharacterId: "g1", inCharge: true }),
          a({ generalCharacterId: "g2", inCharge: true }),
        ],
        opts
      )
    ).toMatch(/one theater commander/i);
  });

  it("allows a theater commander at each of two different conflicts", () => {
    expect(
      validateAssignments(
        [
          a({ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }),
          a({ theaterId: "angola", generalCharacterId: "g2", inCharge: true }),
        ],
        opts
      )
    ).toBeNull();
  });

  // Theater validity (the theaterId names a live conflict) is no longer a purely-
  // decidable invariant — conflicts are created during play, so it moved to the
  // route layer, which checks it against the DB. See the assignment route tests.

  it("rejects a general who is not a commissioned general of the country", () => {
    expect(validateAssignments([a({ generalCharacterId: "ghost" })], opts)).toMatch(/general/i);
  });

  it("rejects the same general assigned twice to one conflict", () => {
    expect(validateAssignments([a(), a()], opts)).toMatch(/twice/i);
  });

  it("lets one general post to two different conflicts", () => {
    expect(
      validateAssignments([a({ theaterId: "afghan" }), a({ theaterId: "angola" })], opts)
    ).toBeNull();
  });
});

describe("isAssignedTo / theaterCommanderOf", () => {
  it("is true only at the front the general is assigned to", () => {
    const list = [a({ generalCharacterId: "g1", theaterId: "afghan" })];
    expect(isAssignedTo(list, "g1", "afghan")).toBe(true);
    expect(isAssignedTo(list, "g1", "angola")).toBe(false);
  });

  it("returns the in-charge general, not a supporting one", () => {
    const list = [
      a({ generalCharacterId: "g2", inCharge: false }),
      a({ generalCharacterId: "g1", inCharge: true }),
    ];
    expect(theaterCommanderOf(list, "afghan")).toBe("g1");
  });

  it("returns null when a conflict has no theater commander", () => {
    expect(theaterCommanderOf([a({ inCharge: false })], "afghan")).toBeNull();
  });
});

describe("generalLeadingUnit", () => {
  it("resolves a unit's assigned general at the front that general is posted to", () => {
    const list = [a({ generalCharacterId: "g1", theaterId: "afghan" })];
    expect(generalLeadingUnit(list, "g1", "afghan")).toBe("g1");
  });

  // Defence-in-depth: the unit's reconciled theater normally equals its general's
  // posting. If an unreconciled unit sits at a front its general is not posted to,
  // it inherits no general there rather than a phantom buff.
  it("returns null when the unit's theater does not match its general's posting", () => {
    const list = [a({ generalCharacterId: "g1", theaterId: "afghan" })];
    expect(generalLeadingUnit(list, "g1", "angola")).toBeNull();
  });

  it("returns null for an unassigned unit", () => {
    const list = [a({ generalCharacterId: "g1", theaterId: "afghan" })];
    expect(generalLeadingUnit(list, null, "afghan")).toBeNull();
  });
});

describe("theaterOfUnit", () => {
  const posted = [a({ theaterId: "afghan", generalCharacterId: "g1", inCharge: true })];

  it("returns reserve when the unit has no general", () => {
    expect(theaterOfUnit(null, posted)).toBe("reserve");
  });

  it("returns reserve when the general is not posted to any conflict", () => {
    expect(theaterOfUnit("g2", posted)).toBe("reserve");
  });

  it("returns the general's posted theater", () => {
    expect(theaterOfUnit("g1", posted)).toBe("afghan");
  });
});
