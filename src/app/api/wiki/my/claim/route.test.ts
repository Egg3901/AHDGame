import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import { POST } from "./route";

describe("corporation wiki claim", () => {
  const userId = new ObjectId();
  const characterId = new ObjectId();
  const corpFindOne = vi.fn();
  const pageFindOne = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkWikiDisabled).mockResolvedValue(null);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: userId.toHexString(), character: { _id: characterId } },
    } as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as ReturnType<typeof checkRateLimit>);
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => ({
        findOne: name === "corporations" ? corpFindOne : pageFindOne,
      }),
    } as unknown as Awaited<ReturnType<typeof getDb>>);
    corpFindOne.mockResolvedValue({ sequentialId: 931, name: "Requested Corporation" });
    pageFindOne.mockResolvedValue({ slug: "corp-931" });
  });

  it("selects the viewed corporation when a CEO leads more than one", async () => {
    const response = await POST(
      new Request("http://localhost/api/wiki/my/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "corporation", corporationSequentialId: 931 }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "corp-931", created: false });
    expect(corpFindOne).toHaveBeenCalledWith({
      ceoId: characterId,
      userId,
      sequentialId: 931,
    });
  });

  it("rejects a request for a corporation the caller does not lead", async () => {
    corpFindOne.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/wiki/my/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "corporation", corporationSequentialId: 112 }),
      })
    );

    expect(response.status).toBe(403);
    expect(pageFindOne).not.toHaveBeenCalled();
    expect(corpFindOne).toHaveBeenCalledWith({
      ceoId: characterId,
      userId,
      sequentialId: 112,
    });
  });
});
