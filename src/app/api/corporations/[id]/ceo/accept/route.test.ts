import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/bonds/ceoBondConflict", () => ({ holdsAnyBondsInCorp: vi.fn() }));
vi.mock("@/lib/corporations/ceoHistory", () => ({
  openCeoTenure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(80) }));

let db: MockDb;
const userId = new ObjectId();
const charId = new ObjectId();
const corpId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: userId.toString(),
      character: { _id: charId, homeState: "CA", countryId: "US" },
    },
  } as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: corpId,
      name: "Sinopec",
      pendingCeoCharacterId: charId,
      headquartersState: "CA",
      countryId: "US",
      ceoId: undefined,
      userId,
    },
  } as never);
  // no other corp where this char is already CEO
  db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);
});

function req() {
  return new Request("http://localhost/api/corporations/x/ceo/accept", { method: "POST" });
}

describe("POST ceo/accept — CEO ⊥ bondholder", () => {
  it("rejects with unit count when the candidate holds the corp's bonds", async () => {
    const { holdsAnyBondsInCorp } = await import("@/lib/bonds/ceoBondConflict");
    vi.mocked(holdsAnyBondsInCorp).mockResolvedValue({ holds: true, units: 970976 });
    const { POST } = await import("./route");
    const res = await POST(req(), { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("970,976 units");
  });

  it("allows acceptance when the candidate holds no bonds", async () => {
    const { holdsAnyBondsInCorp } = await import("@/lib/bonds/ceoBondConflict");
    vi.mocked(holdsAnyBondsInCorp).mockResolvedValue({ holds: false, units: 0 });
    const { POST } = await import("./route");
    const res = await POST(req(), { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);
  });
});

describe("POST ceo/accept — seat type reset", () => {
  beforeEach(async () => {
    const { holdsAnyBondsInCorp } = await import("@/lib/bonds/ceoBondConflict");
    vi.mocked(holdsAnyBondsInCorp).mockResolvedValue({ holds: false, units: 0 });
  });

  it("stamps ceoType 'character' when a human takes over an NPP-run corp", async () => {
    // Regression: a corp whose previous CEO was an NPP keeps ceoType:"npp" unless
    // this write resets it. corporationDetail resolves the CEO from the collection
    // named by ceoType, so a stale "npp" renders "CEO Vacant" even though ceoId
    // points at a live character (live bug: corp 855 Huabei Limited Corp).
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Huabei Limited Corp",
        pendingCeoCharacterId: charId,
        headquartersState: "CA",
        countryId: "US",
        ceoId: new ObjectId(),
        ceoType: "npp",
        userId,
      },
    } as never);
    const { POST } = await import("./route");
    await POST(req(), { params: Promise.resolve({ id: corpId.toString() }) });
    const [, update] = db.collectionMocks["corporations"]!.updateOne.mock.calls[0];
    expect(update.$set.ceoType).toBe("character");
  });

  it("clears a stale caretakerCeo when a human takes the seat", async () => {
    // The caretaker record names the human to restore on dismissal. Once a new
    // human is seated directly, leaving it would let a later dismissal overwrite
    // the sitting CEO with the previous one.
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Huabei Limited Corp",
        pendingCeoCharacterId: charId,
        headquartersState: "CA",
        countryId: "US",
        ceoId: new ObjectId(),
        ceoType: "npp",
        caretakerCeo: {
          underlyingCharacterId: new ObjectId(),
          underlyingUserId: new ObjectId(),
          appointedTurn: 1100,
        },
        userId,
      },
    } as never);
    const { POST } = await import("./route");
    await POST(req(), { params: Promise.resolve({ id: corpId.toString() }) });
    const [, update] = db.collectionMocks["corporations"]!.updateOne.mock.calls[0];
    expect(update.$unset).toHaveProperty("caretakerCeo");
  });
});
