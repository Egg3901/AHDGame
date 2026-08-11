import { describe, it, expect } from "vitest";
import { youtubeThumbnailUrl } from "./youtubeThumbnail";

describe("youtubeThumbnailUrl", () => {
  // Regression: the album-art thumbnail used `maxresdefault.jpg`, which only
  // exists for videos that shipped an HD thumbnail — everything else 404s. A
  // 404 upstream fed to next/image during streaming SSR surfaces as the
  // framework-internal `controller[kState].transformAlgorithm is not a function`
  // error (vercel/next.js#75995). `hqdefault.jpg` exists for every video.
  it("uses hqdefault (which exists for every video), not maxresdefault", () => {
    const url = youtubeThumbnailUrl("dQw4w9WgXcQ");
    expect(url).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(url).not.toContain("maxresdefault");
  });
});
