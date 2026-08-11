import { describe, expect, it, vi, afterEach } from "vitest";
import {
  redirectToFirstAvailableImage,
  redirectToFallbackImage,
  resetImageValidationCacheForTests,
} from "./publicImageProxy";

vi.mock("@/lib/security/ssrfGuard", () => ({
  isUrlSafeToFetch: vi.fn().mockResolvedValue(true),
}));

describe("publicImageProxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetImageValidationCacheForTests();
  });

  it("falls through to the next candidate when the first one is not an image", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response("not found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "image/png" } })
      );

    const response = await redirectToFirstAvailableImage(
      ["https://example.com/missing.png", "https://example.com/fallback.png"],
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("https://example.com/fallback.png");
  });

  it("serves an octet-stream candidate when the URL has a known image extension", async () => {
    // Our R2/CDN serves uploaded .webp logos with Content-Type: application/octet-stream.
    // These are real images and must still be served rather than skipped.
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const response = await redirectToFirstAvailableImage(
      ["https://cdn.ahousedividedgame.com/party-logos/us-4-1780443631681.webp"],
      "https://ahousedividedgame.com/api/logos/parties/4?country=us",
      "public, max-age=60"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(
      "https://cdn.ahousedividedgame.com/party-logos/us-4-1780443631681.webp"
    );
  });

  it("serves an octet-stream candidate when an image extension precedes a query string", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const response = await redirectToFirstAvailableImage(
      ["https://cdn.ahousedividedgame.com/party-logos/us-4.png?v=2"],
      "https://ahousedividedgame.com/api/logos/parties/4?country=us",
      "public, max-age=60"
    );

    expect(response?.headers.get("location")).toBe(
      "https://cdn.ahousedividedgame.com/party-logos/us-4.png?v=2"
    );
  });

  it("skips an octet-stream candidate when the URL has no image extension", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("binary blob", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const response = await redirectToFirstAvailableImage(
      ["https://example.com/some-download"],
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );

    expect(response).toBeNull();
  });

  it("returns null when no candidate can be served as an image", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("bad response", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const response = await redirectToFirstAvailableImage(
      ["https://example.com/not-image"],
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );

    expect(response).toBeNull();
  });

  it("reuses cached validation results for repeated image candidates", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { "content-type": "image/png" } })
      );

    const firstResponse = await redirectToFirstAvailableImage(
      ["https://example.com/party.png"],
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );
    const secondResponse = await redirectToFirstAvailableImage(
      ["https://example.com/party.png"],
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResponse?.headers.get("location")).toBe("https://example.com/party.png");
    expect(secondResponse?.headers.get("location")).toBe("https://example.com/party.png");
  });

  it("caps validation results and evicts the least recently used URL", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () =>
        Promise.resolve(
          new Response(null, { status: 200, headers: { "content-type": "image/png" } })
        )
      );
    const requestUrl = "https://ahousedividedgame.com/api/logos/parties/2?country=uk";

    for (let index = 0; index < 500; index++) {
      await redirectToFirstAvailableImage(
        [`https://example.com/logo-${index}.png`],
        requestUrl,
        "public, max-age=60"
      );
    }

    await redirectToFirstAvailableImage(
      ["https://example.com/logo-0.png"],
      requestUrl,
      "public, max-age=60"
    );
    await redirectToFirstAvailableImage(
      ["https://example.com/logo-500.png"],
      requestUrl,
      "public, max-age=60"
    );
    await redirectToFirstAvailableImage(
      ["https://example.com/logo-1.png"],
      requestUrl,
      "public, max-age=60"
    );

    expect(fetchMock).toHaveBeenCalledTimes(502);
  });

  it("builds a redirect response for the fallback image", () => {
    const response = redirectToFallbackImage(
      "/ahd-logo.png",
      "https://ahousedividedgame.com/api/logos/parties/2?country=uk",
      "public, max-age=60"
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://ahousedividedgame.com/ahd-logo.png");
  });
});
