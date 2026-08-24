import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(async () => null),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");

const HOLDER = "char_holder";
const HEAD_OF_GOVERNMENT = "char_hog";
const OUTSIDER = "char_outsider";

// DD's defence seat, per DEFENSE_POSITION_BY_COUNTRY.
const call = { params: Promise.resolve({ code: "dd", positionId: "minister_of_defence" }) };

let db: MockDb;

function signInAs(characterId: string) {
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: characterId } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(HEAD_OF_GOVERNMENT as never);

  db.collection("gameState");
  db.collection("cabinetMembers");
  db.collection("nuclearPrograms");
  db.collection("nationalDoctrine");
  db.collection("electedOfficials");
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    coldWarEnabled: true,
    currentYear: 1955,
    currentTurn: 42,
    startingYear: 1953,
  });
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
    _id: "m1",
    countryId: "DD",
    positionId: "minister_of_defence",
    characterId: HOLDER,
  });
  db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
});

// `?.status` rather than a bare property read: these handlers are typed as
// possibly-undefined (requireAuth's result is not a discriminated union), and an
// undefined response fails the assertion just as loudly as a wrong status.
describe("GET nuclear — who may read the programme", () => {
  async function nuclearStatus() {
    const { GET } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/nuclear/route");
    const res = await GET(new Request("http://x"), call);
    return res?.status;
  }

  it("serves the programme to the defence holder", async () => {
    signInAs(HOLDER);

    expect(await nuclearStatus()).toBe(200);
  });

  it("serves the programme to the head of government, who can open the office", async () => {
    signInAs(HEAD_OF_GOVERNMENT);

    expect(await nuclearStatus()).toBe(200);
  });

  it("refuses a player who may not open the office at all", async () => {
    signInAs(OUTSIDER);

    expect(await nuclearStatus()).toBe(403);
  });
});

describe("POST nuclear/adopt — who may run the programme", () => {
  async function adoptStatus() {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/nuclear/adopt/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "fission_device" }),
      }),
      call
    );
    return res?.status;
  }

  it("refuses the head of government, who may read the office but not work it", async () => {
    signInAs(HEAD_OF_GOVERNMENT);

    expect(await adoptStatus()).toBe(403);
  });

  it("refuses an outsider", async () => {
    signInAs(OUTSIDER);

    expect(await adoptStatus()).toBe(403);
  });
});
