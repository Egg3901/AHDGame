import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi
    .fn()
    .mockResolvedValue({ ok: true, user: { character: { _id: "actor", name: "Actor" } } }),
}));
vi.mock("@/lib/api/requireForeignMinister", () => ({
  requireForeignMinister: vi
    .fn()
    .mockResolvedValue({ ok: true, auth: { characterId: "actor", characterName: "Actor" } }),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/internationalOrganizations/commands/createOrganization", () => ({
  createInternationalOrganization: vi
    .fn()
    .mockResolvedValue({ ok: true, organizationId: "chosen" }),
}));
const { POST } = await import("./route");
const { createInternationalOrganization } =
  await import("@/lib/internationalOrganizations/commands/createOrganization");

async function post(color: unknown) {
  return POST(
    new Request("http://localhost/api/country/jp/international-organizations/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "chosen",
        name: "Chosen Bloc",
        shortName: "CB",
        description: "A Bloc",
        charter: "Cooperate",
        leadershipTitle: "Chair",
        category: "bloc",
        alignmentAccentToken: color,
      }),
    }),
    { params: Promise.resolve({ code: "jp" }) }
  );
}
beforeEach(() => vi.clearAllMocks());
describe("Bloc creation color validation", () => {
  it.each(["#a855f7", "#008080", "#ABCDEF", "info", "error", "warning"])(
    "accepts and forwards %s unchanged",
    async (color) => {
      expect((await post(color)).status).toBe(200);
      expect(createInternationalOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ alignmentAccentToken: color }) })
      );
    }
  );
  it.each(["#abc", "#12345678", "red", "#gggggg", "url(evil)", "", null, 123, undefined])(
    "rejects invalid or absent color %s before writes",
    async (color) => {
      expect((await post(color)).status).toBe(400);
      expect(createInternationalOrganization).not.toHaveBeenCalled();
    }
  );
});
