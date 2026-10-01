import { describe, expect, it } from "vitest";
import { planRussianCouncilPlayerAdmission as plan } from "./councilPlayerAdmission";

const npc = (id: string, order: number) => ({
  id,
  ownerId: "profile",
  party: "1",
  isNpc: true,
  bounded: true,
  registrationOrder: order,
});
const player = (id: string, ownerId = id) => ({
  ...npc(id, 10),
  ownerId,
  isNpc: false,
  bounded: false,
});
describe("Council player association admission", () => {
  it("replaces one bounded automatic nominee while retaining the earlier registration", () => {
    const candidates = [npc("a", 1), npc("b", 2)];
    const before = structuredClone(candidates);
    expect(plan({ ownerId: "player", party: "1", candidates })).toEqual({
      allowed: true,
      withdrawIds: ["b"],
      associationNominees: 1,
    });
    expect(candidates).toEqual(before);
  });
  it("preserves another player when an automatic slot remains", () => {
    expect(plan({ ownerId: "new", party: "1", candidates: [player("a"), npc("b", 2)] })).toEqual({
      allowed: true,
      withdrawIds: ["b"],
      associationNominees: 1,
    });
  });
  it("never removes another player", () => {
    expect(plan({ ownerId: "new", party: "1", candidates: [player("a"), player("b")] })).toEqual({
      allowed: false,
      reason: "association-full",
    });
  });
  it("never replaces an unbounded legacy NPC", () => {
    expect(
      plan({
        ownerId: "new",
        party: "1",
        candidates: [player("a"), { ...npc("b", 2), bounded: false }],
      })
    ).toEqual({ allowed: false, reason: "association-full" });
  });
  it("does not impose an association cap on separate independent voter groups", () => {
    expect(
      plan({
        ownerId: "new",
        party: "independent",
        candidates: [player("a"), player("b")].map((row) => ({ ...row, party: "independent" })),
      })
    ).toEqual({ allowed: true, withdrawIds: [], associationNominees: 0 });
  });
  it("plans a party change and automatic replacement together", () => {
    expect(
      plan({
        ownerId: "owner",
        party: "1",
        candidates: [{ ...player("old", "owner"), party: "2" }, npc("a", 1), npc("b", 2)],
      })
    ).toEqual({ allowed: true, withdrawIds: ["old", "b"], associationNominees: 1 });
  });
  it("rejects duplicate filing without withdrawing anything", () => {
    expect(plan({ ownerId: "owner", party: "1", candidates: [player("old", "owner")] })).toEqual({
      allowed: false,
      reason: "already-filed",
    });
  });
  it("fails closed on an overfilled association", () => {
    expect(
      plan({ ownerId: "owner", party: "1", candidates: [npc("a", 1), npc("b", 2), npc("c", 3)] })
    ).toEqual({ allowed: false, reason: "association-full" });
  });
  it("accepts an empty slot without replacing anyone", () => {
    expect(plan({ ownerId: "owner", party: "1", candidates: [npc("a", 1)] })).toEqual({
      allowed: true,
      withdrawIds: [],
      associationNominees: 1,
    });
  });
  it("uses stable identity ordering for equal registration times", () => {
    expect(plan({ ownerId: "owner", party: "1", candidates: [npc("a", 1), npc("b", 1)] })).toEqual({
      allowed: true,
      withdrawIds: ["b"],
      associationNominees: 1,
    });
  });
  it.each(["identity", "duplicate", "order"])("rejects invalid %s", (reason) => {
    const candidates = [npc("a", 1), npc("b", 2)];
    if (reason === "identity") candidates[0].ownerId = "";
    if (reason === "duplicate") candidates[1].id = "a";
    if (reason === "order") candidates[0].registrationOrder = -1;
    expect(() => plan({ ownerId: "owner", party: "1", candidates })).toThrow("identities");
  });
});
