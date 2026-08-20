import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/settlement/queries/dossier", () => ({ loadGermanQuestionDossier: vi.fn() }));

const characterId = new ObjectId();

describe("GET /api/world/german-question", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId } },
    } as never);
    const { loadGermanQuestionDossier } = await import("@/lib/settlement/queries/dossier");
    vi.mocked(loadGermanQuestionDossier).mockResolvedValue({ crisisId: "c1" } as never);
  });

  it("rejects an unauthenticated caller", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });

  it("does not query when auth fails", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { GET } = await import("./route");
    await GET();
    const { loadGermanQuestionDossier } = await import("@/lib/settlement/queries/dossier");
    expect(vi.mocked(loadGermanQuestionDossier)).not.toHaveBeenCalled();
  });

  it("404s when the feature is off or no crisis is open", async () => {
    const { loadGermanQuestionDossier } = await import("@/lib/settlement/queries/dossier");
    vi.mocked(loadGermanQuestionDossier).mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(404);
  });

  it("returns the view for the authenticated character", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ view: { crisisId: "c1" } });
    const { loadGermanQuestionDossier } = await import("@/lib/settlement/queries/dossier");
    expect(vi.mocked(loadGermanQuestionDossier).mock.calls[0][1]).toBe(characterId);
  });

  it("surfaces an unexpected failure as a handled error", async () => {
    const { loadGermanQuestionDossier } = await import("@/lib/settlement/queries/dossier");
    vi.mocked(loadGermanQuestionDossier).mockRejectedValue(new Error("mongo is down"));
    const { GET } = await import("./route");
    expect((await GET()).status).toBeGreaterThanOrEqual(500);
  });
});
