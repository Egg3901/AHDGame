import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { organizeSector } from "@/lib/unions/commands/organizeSector";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn() }));
vi.mock("@/lib/unions/commands/organizeSector", () => ({ organizeSector: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

const unionId = new ObjectId().toString();
const sectorA = new ObjectId().toString();
const sectorB = new ObjectId().toString();
const sectorC = new ObjectId().toString();
let db: MockDb;

const landed = {
  ok: true as const,
  status: 200 as const,
  wasRaid: false,
  won: true,
  unionization: 12,
  representingUnionId: unionId,
  cashSpent: 1000,
  actionsSpent: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);
  vi.mocked(isLabourFullMode).mockResolvedValue(true);
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  let actions = 5;
  // Each read returns the balance after the previous drive, as the real
  // character document would.
  vi.mocked(getCharacterByUserId).mockImplementation(
    async () => ({ _id: new ObjectId(), actions: actions-- }) as never
  );
  vi.mocked(organizeSector).mockResolvedValue(landed);
});

function request(body: unknown): Request {
  return new Request(`http://localhost/api/unions/${unionId}/organize-sectors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: unionId }) };

describe("POST /api/unions/[id]/organize-sectors", () => {
  it("runs every drive in order against a fresh character read", async () => {
    const response = await POST(request({ sectorIds: [sectorA, sectorB] }), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ completed: 2, requested: 2, stopped: null });
    expect(body.results.map((r: { sectorId: string }) => r.sectorId)).toEqual([sectorA, sectorB]);
    expect(organizeSector).toHaveBeenNthCalledWith(
      1,
      db,
      expect.objectContaining({ actions: 5 }),
      unionId,
      sectorA
    );
    expect(organizeSector).toHaveBeenNthCalledWith(
      2,
      db,
      expect.objectContaining({ actions: 4 }),
      unionId,
      sectorB
    );
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it("stops at the first refusal and keeps the drives that landed", async () => {
    vi.mocked(organizeSector).mockResolvedValueOnce(landed).mockResolvedValueOnce({
      ok: false,
      status: 402,
      error: "Not enough union treasury to run an organizing drive.",
    });

    const response = await POST(request({ sectorIds: [sectorA, sectorB, sectorC] }), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completed).toBe(1);
    expect(body.stopped).toEqual({
      sectorId: sectorB,
      status: 402,
      error: "Not enough union treasury to run an organizing drive.",
    });
    expect(organizeSector).toHaveBeenCalledTimes(2);
  });

  it("returns the refusal itself when the first drive fails", async () => {
    vi.mocked(organizeSector).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Only the union leader can do that.",
    });

    const response = await POST(request({ sectorIds: [sectorA, sectorB] }), ctx);

    expect(response.status).toBe(403);
    expect(organizeSector).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicates, empty and oversized batches before any drive", async () => {
    for (const sectorIds of [
      [sectorA, sectorA],
      [],
      Array.from({ length: 11 }, () => new ObjectId().toString()),
    ]) {
      const response = await POST(request({ sectorIds }), ctx);
      expect(response.status).toBe(400);
    }
    expect(organizeSector).not.toHaveBeenCalled();
  });

  it("refuses while player-run unions are off", async () => {
    vi.mocked(isLabourFullMode).mockResolvedValue(false);
    const response = await POST(request({ sectorIds: [sectorA] }), ctx);
    expect(response.status).toBe(403);
    expect(organizeSector).not.toHaveBeenCalled();
  });
});
