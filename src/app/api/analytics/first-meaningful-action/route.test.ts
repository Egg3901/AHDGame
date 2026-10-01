import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findOne: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.auth }));
vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({ collection: () => ({ findOne: mocks.findOne }) }),
}));
vi.mock("@/lib/analytics/characterActivation", () => ({ claimCharacterActivation: mocks.claim }));
import { POST } from "./route";
const characterId = "0123456789abcdef01234567";
function request(body: unknown) {
  return new Request("http://localhost/api/analytics/first-meaningful-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
describe("first meaningful action claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, user: { userId: "abcdef0123456789abcdef01" } });
    mocks.findOne.mockResolvedValue({ _id: characterId });
    mocks.claim.mockResolvedValue({ turn_number: 12 });
  });
  it("requires explicit current consent", async () => {
    expect((await POST(request({ characterId, consent: false }))).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("requires the account to own the character", async () => {
    mocks.findOne.mockResolvedValue(null);
    expect((await POST(request({ characterId, consent: true }))).status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("returns only the claimed scalar metadata", async () => {
    const response = await POST(request({ characterId, consent: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activation: { turn_number: 12 } });
    expect(mocks.findOne).toHaveBeenCalledWith(
      { _id: expect.anything(), userId: expect.anything() },
      { projection: { _id: 1 } }
    );
  });
});
