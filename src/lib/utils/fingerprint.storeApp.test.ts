// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { getThumbmark } = vi.hoisted(() => ({ getThumbmark: vi.fn() }));
vi.mock("@thumbmarkjs/thumbmarkjs", () => ({ getThumbmark }));

import { generateFingerprintData } from "./fingerprint";

afterEach(() => {
  vi.restoreAllMocks();
  getThumbmark.mockReset();
});

describe("generateFingerprintData in the store app", () => {
  it("does not fingerprint the AHDClient phone app", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AHDClient-Mobile/2.3.19"
    );
    await expect(generateFingerprintData()).resolves.toEqual({ hash: "", components: {} });
    expect(getThumbmark).not.toHaveBeenCalled();
  });
});
