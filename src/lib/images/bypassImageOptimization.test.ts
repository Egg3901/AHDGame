import { describe, expect, it } from "vitest";
import { bypassNextImageOptimization } from "./bypassImageOptimization";

describe("bypassNextImageOptimization", () => {
  it("bypasses relative local API routes", () => {
    expect(bypassNextImageOptimization("/api/uploads/avatars/x.webp")).toBe(true);
    expect(bypassNextImageOptimization("/api/images/foo")).toBe(true);
    expect(bypassNextImageOptimization("/api/logos/foo")).toBe(true);
    expect(bypassNextImageOptimization("/api/flags/country/us")).toBe(true);
  });

  it("bypasses host-prefixed local API routes (dev localhost + prod host)", () => {
    expect(bypassNextImageOptimization("http://localhost:3000/api/uploads/avatars/x.webp")).toBe(
      true
    );
    expect(
      bypassNextImageOptimization("https://app.ahousedividedgame.com/api/uploads/avatars/x.webp")
    ).toBe(true);
    expect(bypassNextImageOptimization("http://127.0.0.1:3000/api/images/foo")).toBe(true);
  });

  it("still bypasses absolute CDN/host sources", () => {
    expect(bypassNextImageOptimization("https://cdn.ahousedividedgame.com/x.png")).toBe(true);
    expect(bypassNextImageOptimization("https://upload.wikimedia.org/x.png")).toBe(true);
    expect(bypassNextImageOptimization("https://abc.public.blob.vercel-storage.com/x.png")).toBe(
      true
    );
  });

  it("does not bypass arbitrary remote images or empty input", () => {
    expect(bypassNextImageOptimization("")).toBe(false);
    expect(bypassNextImageOptimization("https://images.unsplash.com/x.jpg")).toBe(false);
    expect(bypassNextImageOptimization("https://example.com/api/uploads/evil.png")).toBe(true);
  });
  it("bypasses en.wikipedia.org so fair-use logos skip the optimizer host check", () => {
    // Union emblems and UK:UUP live on en.wikipedia, not Commons. Routing them
    // through /_next/image returns 400 (host not in remotePatterns) and the
    // caller silently falls back to a placeholder.
    expect(
      bypassNextImageOptimization("https://en.wikipedia.org/wiki/Special:FilePath/USDAW_logo.png")
    ).toBe(true);
  });
});
