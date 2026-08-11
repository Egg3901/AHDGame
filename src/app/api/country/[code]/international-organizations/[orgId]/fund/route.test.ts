import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: vi.fn(),
  loadOrganizationDef: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { isMember, loadOrganizationDef } = await import("@/lib/internationalOrganizations/service");

function setup() {
  const characterId = new ObjectId();
  const billCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "bills") return billCollection;
      return {};
    }),
  };
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: "u1", character: { _id: characterId, name: "Klaus", party: "spd" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: { countryId: "DE", characterId, characterName: "Klaus" },
  } as never);
  vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "EU", name: "European Union" } as never);
  return { billCollection };
}

async function post(body: unknown) {
  const { POST } =
    await import("@/app/api/country/[code]/international-organizations/[orgId]/fund/route");
  return POST(
    new Request("http://localhost/api/country/de/international-organizations/EU/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code: "de", orgId: "EU" }) }
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST .../[orgId]/fund", () => {
  it("creates a fund bill for a member", async () => {
    const { billCollection } = setup();
    vi.mocked(isMember).mockResolvedValue(true);
    const res = await post({ amountLocal: 5_000_000 });
    expect(res.status).toBe(200);
    expect(billCollection.insertOne).toHaveBeenCalledTimes(1);
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      category: string;
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.category).toBe("foreign policy");
    expect(inserted.provisions[0]).toMatchObject({
      type: "international_organization",
      subType: "fund",
      organizationId: "EU",
      amountLocal: 5_000_000,
    });
  });

  it("rejects a non-member", async () => {
    const { billCollection } = setup();
    vi.mocked(isMember).mockResolvedValue(false);
    const res = await post({ amountLocal: 5_000_000 });
    expect(res.status).toBe(400);
    expect(billCollection.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    setup();
    vi.mocked(isMember).mockResolvedValue(true);
    const res = await post({ amountLocal: 0 });
    expect(res.status).toBe(400);
  });
});
