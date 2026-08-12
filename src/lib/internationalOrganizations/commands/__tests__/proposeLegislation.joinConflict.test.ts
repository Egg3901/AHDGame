import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";

const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
const recordOrgHistoryEvent = vi.fn().mockResolvedValue(undefined);
let orgCategory = "bloc";
let conflict: ConflictDoc | null = null;

vi.mock("@/lib/db/collections", () => ({
  getOrganizationLegislationCollection: async () => ({ insertOne }),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: async () => ["US", "UK", "FR"],
  loadOrganizationDefWithPowers: async () => ({
    id: "NATO",
    shortName: "NATO",
    category: orgCategory,
  }),
  recordOrgHistoryEvent: (...args: unknown[]) => recordOrgHistoryEvent(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: async () => 500 }));
vi.mock("@/lib/db/collections/conflicts", () => ({
  getConflict: async () => conflict,
}));

const { proposeOrganizationLegislation } = await import("../proposeLegislation");

const CONFLICT: ConflictDoc = {
  _id: "korea-1953",
  conflictId: 7,
  name: "Korean War",
  status: "active",
  sideA: { label: "United Nations Command", countries: ["US"] },
  sideB: { label: "Korean People's Army", countries: ["KP"] },
} as unknown as ConflictDoc;

let conflictsEnabled = true;

const stubDb = () =>
  ({
    collection: () => ({ findOne: async () => ({ _id: "current", conflictsEnabled }) }),
  }) as unknown as Db;

const propose = (input: Record<string, unknown>) =>
  proposeOrganizationLegislation({
    db: stubDb(),
    countryId: "US",
    orgId: "NATO",
    actor: { characterId: new ObjectId(), characterName: "Secretary of State" },
    input: input as never,
  });

describe("tabling a join_conflict resolution", () => {
  beforeEach(() => {
    insertOne.mockClear();
    recordOrgHistoryEvent.mockClear();
    orgCategory = "bloc";
    conflict = CONFLICT;
    conflictsEnabled = true;
  });

  it("is refused when the Conflicts subsystem is switched off", async () => {
    // Conflict documents outlive the flag, so the conflict lookup below would
    // still succeed — the switch has to be checked in its own right, as the admin
    // create route checks it.
    conflictsEnabled = false;
    const res = await propose({ type: "join_conflict", theaterId: "korea-1953", side: "A" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is accepted at a bloc", async () => {
    const res = await propose({ type: "join_conflict", theaterId: "korea-1953", side: "A" });

    expect(res.ok).toBe(true);
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0]![0]).toMatchObject({ type: "join_conflict", status: "pending" });
  });

  it("is refused at a security-category org", async () => {
    // loadOrganizationDefWithPowers resolves the world's EFFECTIVE category, so a
    // security alliance in a post-Cold-War preset is refused by canTableResolutionType
    // with no new code here.
    orgCategory = "security";
    const res = await propose({ type: "join_conflict", theaterId: "korea-1953", side: "A" });

    expect(res.ok).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is refused when the conflict is missing", async () => {
    conflict = null;
    const res = await propose({ type: "join_conflict", theaterId: "nope", side: "A" });

    expect(res.ok).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is refused when the conflict has already resolved", async () => {
    conflict = { ...CONFLICT, status: "resolved" } as ConflictDoc;
    const res = await propose({ type: "join_conflict", theaterId: "korea-1953", side: "A" });

    expect(res.ok).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("stores the theater _id and the side", async () => {
    await propose({ type: "join_conflict", theaterId: "korea-1953", side: "B" });

    const doc = insertOne.mock.calls[0]![0] as Record<string, unknown>;
    // The _id, never the public conflictId — every lookup, unit theaterId and
    // assignment downstream references _id.
    expect(doc.joinConflictTheaterId).toBe("korea-1953");
    expect(doc.joinConflictSide).toBe("B");
  });

  it("names the backed side in the title and the history entry", async () => {
    await propose({ type: "join_conflict", theaterId: "korea-1953", side: "B" });

    const doc = insertOne.mock.calls[0]![0] as { title: string };
    expect(doc.title).toContain("Korean People's Army");
    expect(recordOrgHistoryEvent).toHaveBeenCalledTimes(1);
  });
});
