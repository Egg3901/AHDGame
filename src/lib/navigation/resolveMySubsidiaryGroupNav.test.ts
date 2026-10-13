import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { resolveMySubsidiaryGroupNav } from "./resolveMySubsidiaryGroupNav";
const parent = new ObjectId("100000000000000000000001");
const child = new ObjectId("100000000000000000000002");
const outsider = new ObjectId("100000000000000000000003");
function fixture(formalized = true, shares = 60, reserved = 0) {
  const rows = [
    { _id: parent, shareholders: [], totalShares: 100 },
    {
      _id: child,
      shareholders: [{ corporationId: parent, shares }],
      totalShares: 100,
      ...(formalized ? { subsidiaryFormalizedAtTurn: 10 } : {}),
    },
    { _id: outsider, shareholders: [], totalShares: 100 },
  ];
  const collection = vi.fn((name: string) => ({
    find: vi.fn(() => ({
      toArray: async () =>
        name === "corporations"
          ? rows
          : name === "shareOrders" && reserved
            ? [
                {
                  corporationId: child,
                  placerCorporationId: parent,
                  sharesRemaining: reserved,
                  type: "sell",
                  status: "open",
                },
              ]
            : [],
    })),
  }));
  return { db: { collection } as unknown as Db, collection };
}
describe("resolveMySubsidiaryGroupNav", () => {
  it.each([parent, child])(
    "shows a formalized Group for either parent or member (%s)",
    async (id) => {
      expect(await resolveMySubsidiaryGroupNav(fixture().db, id, true)).toBe(true);
    }
  );
  it("hides standalone and missing corporations", async () => {
    const { db } = fixture();
    expect(await resolveMySubsidiaryGroupNav(db, outsider, true)).toBe(false);
    expect(await resolveMySubsidiaryGroupNav(db, new ObjectId(), true)).toBe(false);
  });
  it.each([parent, child])("hides ownership without formalization (%s)", async (id) => {
    expect(await resolveMySubsidiaryGroupNav(fixture(false).db, id, true)).toBe(false);
  });
  it("hides a former Group after voting control is lost", async () => {
    const { db } = fixture(true, 50);
    expect(await resolveMySubsidiaryGroupNav(db, parent, true)).toBe(false);
    expect(await resolveMySubsidiaryGroupNav(db, child, true)).toBe(false);
  });
  it("preserves control while shares are reserved on an open sale", async () => {
    const { db } = fixture(true, 40, 20);
    expect(await resolveMySubsidiaryGroupNav(db, parent, true)).toBe(true);
    expect(await resolveMySubsidiaryGroupNav(db, child, true)).toBe(true);
  });
  it("does no ownership reads without a corporation or while subsidiaries are disabled", async () => {
    const { db, collection } = fixture();
    expect(await resolveMySubsidiaryGroupNav(db, null, true)).toBe(false);
    expect(await resolveMySubsidiaryGroupNav(db, child, false)).toBe(false);
    expect(collection).not.toHaveBeenCalled();
  });
});
