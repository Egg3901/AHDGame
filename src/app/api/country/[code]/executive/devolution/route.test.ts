import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireHumanSessionWithCharacter: vi.fn(),
}));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({ isSittingLeader: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("@/lib/governorOffice/devolution/queries", () => ({
  loadIndependenceDesireSnapshots: vi
    .fn()
    .mockResolvedValue([{ stateId: "NIR", westminsterPolicy: "independence" }]),
}));
import { getDb } from "@/lib/mongodb";
import { requireAuth, requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { GET, POST } from "./route";
const context = (code = "uk") => ({ params: Promise.resolve({ code }) });
const request = (body: unknown = { stateId: "SCO", policy: "independence" }) =>
  new Request("http://localhost/api/country/uk/executive/devolution", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("UK executive devolution API", () => {
  let db: ReturnType<typeof createMockDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const auth = {
      ok: true,
      user: { isAdmin: false, character: { _id: new ObjectId() } },
    } as const;
    vi.mocked(requireAuth).mockResolvedValue(auth as never);
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue(auth as never);
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    db.collection("governorOfficeState").findOne.mockResolvedValue({ gubernatorialActions: 2 });
  });
  it.each([GET, POST])("rejects other countries", async (handler) => {
    expect((await handler(request(), context("de"))).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("requires authentication for reads", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: NextResponse.json({}, { status: 401 }),
    });
    expect((await GET(request(), context())).status).toBe(401);
  });
  it("requires a human character session for writes", async () => {
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({}, { status: 403 }),
    });
    expect((await POST(request(), context())).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("lets FMs and ordinary authenticated viewers read stances without edit authority", async () => {
    vi.mocked(isSittingLeader).mockResolvedValue(false);
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canManage: false,
      regions: [{ stateId: "NIR", westminsterPolicy: "independence" }],
    });
  });
  it("rejects an FM or former PM attempting a write", async () => {
    vi.mocked(isSittingLeader).mockResolvedValue(false);
    expect((await POST(request(), context())).status).toBe(403);
    expect(db.collection("governorOfficeState").updateOne).not.toHaveBeenCalled();
  });
  it.each([
    { stateId: "LON", policy: "anti" },
    { stateId: "SCO", policy: "bad" },
    { stateId: "SCO", policy: "pro", adminOverride: true },
  ])("validates the complete request %j", async (body) => {
    expect((await POST(request(body), context())).status).toBe(400);
    expect(db.collection("governorOfficeState").updateOne).not.toHaveBeenCalled();
  });
  it("applies a PM stance through the real atomic domain writer", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ policy: "independence", changedAtTurn: 100 });
    expect(db.collection("governorOfficeState").updateOne.mock.calls[0][1].$inc).toEqual({
      gubernatorialActions: -2,
    });
  });
  it("returns a concurrent update conflict", async () => {
    db.collection("governorOfficeState").updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await POST(request(), context())).status).toBe(409);
  });
});
