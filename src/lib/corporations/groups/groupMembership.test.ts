import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { resolveFormalizedGroups } from "./groupMembership";

const PARENT = new ObjectId();
const CHILD = new ObjectId();
const GRANDCHILD = new ObjectId();
const OUTSIDER = new ObjectId();

/** A corp whose sole corporate shareholder holds `pct` of a 100-share float. */
function corp(id: ObjectId, holder: ObjectId | null, pct: number, formalized: boolean) {
  return {
    _id: id,
    totalShares: 100,
    shareholders: holder ? [{ corporationId: holder, shares: pct }] : [],
    ...(formalized ? { subsidiaryFormalizedAtTurn: 10 } : {}),
  };
}

function makeDb(corps: unknown[]) {
  return {
    collection: () => ({ find: () => ({ toArray: () => Promise.resolve(corps) }) }),
  } as unknown as Db;
}

describe("resolveFormalizedGroups", () => {
  it("groups a formalized subsidiary under its parent", async () => {
    const db = makeDb([corp(PARENT, null, 0, false), corp(CHILD, PARENT, 60, true)]);
    const { membersByRootId, rootByCorpId } = await resolveFormalizedGroups(db);
    expect(rootByCorpId.get(CHILD.toString())).toBe(PARENT.toString());
    expect(membersByRootId.get(PARENT.toString())?.sort()).toEqual(
      [PARENT.toString(), CHILD.toString()].sort()
    );
  });

  it("excludes a controlled subsidiary that was never formalized", async () => {
    // De facto control is not a tax group. This is the whole gate: relief is
    // bought with a declaration, not acquired by accident.
    const db = makeDb([corp(PARENT, null, 0, false), corp(CHILD, PARENT, 90, false)]);
    const { membersByRootId } = await resolveFormalizedGroups(db);
    expect(membersByRootId.size).toBe(0);
  });

  it("excludes a formalized corp whose parent no longer controls it", async () => {
    const db = makeDb([corp(PARENT, null, 0, false), corp(CHILD, PARENT, 50, true)]);
    const { membersByRootId } = await resolveFormalizedGroups(db);
    expect(membersByRootId.size).toBe(0);
  });

  // Chains cannot arise today: `isEligibleAsSubsidiaryParent` refuses to let a
  // formalized subsidiary hold one of its own. These two cases exist so the
  // resolver stays correct if that rule is ever relaxed, and so a chain left
  // behind by older data does not silently mis-group.
  it("resolves a chain to its ultimate parent", async () => {
    const db = makeDb([
      corp(PARENT, null, 0, false),
      corp(CHILD, PARENT, 60, true),
      corp(GRANDCHILD, CHILD, 80, true),
    ]);
    const { rootByCorpId, membersByRootId } = await resolveFormalizedGroups(db);
    expect(rootByCorpId.get(GRANDCHILD.toString())).toBe(PARENT.toString());
    expect(membersByRootId.get(PARENT.toString())).toHaveLength(3);
  });

  it("breaks a chain at the first unformalized link", async () => {
    // The grandchild is formalized under the child, but the child is not
    // formalized under the parent — so the group is child + grandchild, and the
    // parent is on its own.
    const db = makeDb([
      corp(PARENT, null, 0, false),
      corp(CHILD, PARENT, 60, false),
      corp(GRANDCHILD, CHILD, 80, true),
    ]);
    const { rootByCorpId, membersByRootId } = await resolveFormalizedGroups(db);
    expect(rootByCorpId.get(GRANDCHILD.toString())).toBe(CHILD.toString());
    expect(membersByRootId.get(CHILD.toString())).toHaveLength(2);
    expect(membersByRootId.has(PARENT.toString())).toBe(false);
  });

  it("terminates on an ownership cycle instead of hanging the turn", async () => {
    const db = makeDb([corp(PARENT, CHILD, 60, true), corp(CHILD, PARENT, 60, true)]);
    const { membersByRootId } = await resolveFormalizedGroups(db);
    // Both land in one group rather than looping forever.
    expect([...membersByRootId.values()][0]).toHaveLength(2);
  });

  it("reports no group for a world of lone corporations", async () => {
    const db = makeDb([corp(PARENT, null, 0, false), corp(OUTSIDER, null, 0, false)]);
    const { membersByRootId } = await resolveFormalizedGroups(db);
    expect(membersByRootId.size).toBe(0);
  });
});
