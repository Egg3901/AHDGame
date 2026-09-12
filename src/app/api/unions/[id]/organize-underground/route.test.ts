import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { organizeUnderground } from "@/lib/unions/commands/organizeUnderground";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn() }));
vi.mock("@/lib/unions/commands/organizeUnderground", () => ({
  organizeUnderground: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

const unionId = new ObjectId();
const character = { _id: new ObjectId(), countryId: "US", actions: 20 };
let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("unions").findOne.mockResolvedValue({
    _id: unionId,
    countryId: "US",
    suspended: true,
  });
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);
  vi.mocked(isLabourFullMode).mockResolvedValue(true);
  vi.mocked(getCharacterByUserId).mockResolvedValue(character as never);
  vi.mocked(organizeUnderground).mockResolvedValue({
    ok: true,
    status: 200,
    undergroundStrength: 21,
    statusLabel: "dark",
    heatText: "cold",
    strengthGain: 9,
    actionsSpent: 10,
  });
});

function request(body: unknown): Request {
  return new Request(`http://localhost/api/unions/${unionId}/organize-underground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/unions/[id]/organize-underground", () => {
  it("rejects an invalid mode before invoking the command", async () => {
    const response = await POST(request({ mode: "loud" }), {
      params: Promise.resolve({ id: unionId.toString() }),
    });

    expect(response.status).toBe(400);
    expect(organizeUnderground).not.toHaveBeenCalled();
  });

  it("passes the validated mode to the command and serializes its result", async () => {
    const response = await POST(request({ mode: "mass" }), {
      params: Promise.resolve({ id: unionId.toString() }),
    });

    expect(response.status).toBe(200);
    expect(organizeUnderground).toHaveBeenCalledWith(
      expect.anything(),
      character,
      expect.objectContaining({ _id: unionId }),
      "mass"
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      undergroundStrength: 21,
      status: "dark",
      strengthGain: 9,
      actionsSpent: 10,
    });
  });
});
