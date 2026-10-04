import { beforeEach, describe, expect, it, vi } from "vitest";
import CountryMapPage, { generateMetadata } from "./page";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/country/countryIdentity", () => ({ resolveCountryIdentity: vi.fn() }));
vi.mock("./CountryMapClient", () => ({ default: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveCountryIdentity).mockResolvedValue({
    name: "United States",
    flagEmoji: "",
    governmentType: "presidential",
    governmentTypeLabel: "Presidential Republic",
  });
});

describe("country map country validation", () => {
  it.each(["UA", "not-a-country", "constructor", "__proto__"])(
    "returns notFound before country-state lookup in metadata (%s)",
    async (code) => {
      await expect(generateMetadata({ params: Promise.resolve({ code }) })).rejects.toThrow(
        "NEXT_HTTP_ERROR_FALLBACK;404"
      );
      expect(getDb).not.toHaveBeenCalled();
      expect(getGameState).not.toHaveBeenCalled();
      expect(resolveCountryIdentity).not.toHaveBeenCalled();
    }
  );

  it("returns notFound from the page for an unknown country", async () => {
    await expect(CountryMapPage({ params: Promise.resolve({ code: "UA" }) })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
  });

  it("keeps runtime identity in metadata for a known country", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ code: "us" }) });
    expect(metadata.title).toBe("United States Map | A House Divided");
    expect(resolveCountryIdentity).toHaveBeenCalled();
  });
});
