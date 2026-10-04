import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: vi.fn(),
  game: vi.fn(),
  character: vi.fn(),
  vacancies: vi.fn(),
  history: vi.fn(),
  designate: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.auth }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.db }));
vi.mock("@/lib/gameState", () => ({ getGameState: mocks.game }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: mocks.character }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: mocks.limit,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/countries/hu/listVacancies1991", () => ({
  loadHu1991ListVacancies: mocks.vacancies,
  loadHu1991ListReplacementHistory: mocks.history,
  designateHu1991ListDeputy: mocks.designate,
  Hu1991ListVacancyConflict: class extends Error {},
}));
import { GET, POST } from "./route";
const params = { params: Promise.resolve({ code: "hu" }) };
const characterId = new ObjectId();
const body = {
  receiptId: "HU:mixed1989:1",
  slotPersonId: "departed",
  personId: "original-nominee",
};
const request = (data: unknown = body) =>
  new Request("http://localhost/api/country/hu/assembly/list-vacancies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toHexString(), isAdmin: false },
  });
  mocks.db.mockResolvedValue({});
  mocks.game.mockResolvedValue({ preset: "1991-default", currentTurn: 102 });
  mocks.character.mockResolvedValue({ _id: characterId, countryId: "HU" });
  mocks.vacancies.mockResolvedValue([{ slotPersonId: "departed" }]);
  mocks.history.mockResolvedValue([{ reason: "autonomous_original_list_order" }]);
  mocks.designate.mockResolvedValue(true);
  mocks.limit.mockReturnValue({ ok: true });
});
describe("Hungarian party list replacement API", () => {
  it("returns vacancies and visible designation reasons without shared caching", async () => {
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      history: [{ reason: "autonomous_original_list_order" }],
      vacancies: [{ slotPersonId: "departed" }],
    });
  });
  it("passes the authenticated chair identity and exact filed choice to the transactional writer", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(mocks.designate).toHaveBeenCalledWith(
      expect.objectContaining({ ...body, turn: 102, actor: { characterId, isAdmin: false } })
    );
  });
  it("refuses a foreign resident before calling the writer", async () => {
    mocks.character.mockResolvedValue({ _id: characterId, countryId: "UK" });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.designate).not.toHaveBeenCalled();
  });
  it("refuses a changed parent or filled vacancy", async () => {
    mocks.designate.mockResolvedValue(false);
    expect((await POST(request(), params)).status).toBe(409);
  });
  it("validates the designation body and disallows caller-supplied authority", async () => {
    expect((await POST(request({ ...body, actor: { isAdmin: true } }), params)).status).toBe(400);
    expect((await POST(request({ ...body, personId: "" }), params)).status).toBe(400);
    expect(mocks.designate).not.toHaveBeenCalled();
  });
  it("enforces authentication, country, preset and request rate limits", async () => {
    expect((await POST(request(), { params: Promise.resolve({ code: "BG" }) })).status).toBe(404);
    mocks.game.mockResolvedValue({ preset: "2027-default", currentTurn: 102 });
    expect((await POST(request(), params)).status).toBe(409);
    mocks.limit.mockReturnValue({ ok: false, retryAfter: 60 });
    expect((await POST(request(), params)).status).toBe(429);
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(new Request("http://localhost"), params)).status).toBe(401);
    expect((await POST(request(), params)).status).toBe(401);
  });
});
