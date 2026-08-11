// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@thumbmarkjs/thumbmarkjs", () => ({ getThumbmark: vi.fn() }));

describe("generateFingerprintData", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the thumbmark hash and a normalized component subset", async () => {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    vi.mocked(getThumbmark).mockResolvedValue({
      thumbmark: "abc123hash",
      components: {
        canvas: { commonImageDataHash: "CANVAS" },
        webgl: { renderer: "Apple GPU", vendor: "Apple" },
        audio: "AUDIO",
        fonts: ["Arial", "Helvetica"],
        hardware: { cores: 8, memory: 8 },
        screen: { mediaMatches: ["x"] },
        system: { browser: { name: "chrome" }, platform: "MacIntel", timezone: "Europe/London" },
      },
      info: {},
      version: "1.9.0",
    } as never);

    const { generateFingerprintData } = await import("./fingerprint");
    const result = await generateFingerprintData();

    expect(result.hash).toBe("abc123hash");
    expect(result.components.canvas).toBe('{"commonImageDataHash":"CANVAS"}');
    expect(result.components.webglRenderer).toBe("Apple GPU");
    expect(result.components.audio).toBe("AUDIO");
    expect(result.components.cores).toBe(8);
    expect(result.components.platform).toBe("MacIntel");
    expect(result.components.timezone).toBe("Europe/London");
  });

  it("generateFingerprint returns just the hash string", async () => {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    vi.mocked(getThumbmark).mockResolvedValue({
      thumbmark: "hash-only",
      components: {},
      info: {},
      version: "1.9.0",
    } as never);
    const { generateFingerprint } = await import("./fingerprint");
    expect(await generateFingerprint()).toBe("hash-only");
  });

  // forensics-v2 Part B: modest client entropy (WebGL unmasked vendor/renderer
  // via WEBGL_debug_renderer_info, navigator.hardwareConcurrency/platform/languages).
  it("layers in unmasked WebGL vendor/renderer + navigator entropy on top of ThumbmarkJS's own extraction", async () => {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    vi.mocked(getThumbmark).mockResolvedValue({
      thumbmark: "hash2",
      components: {
        canvas: { commonImageDataHash: "C" },
        webgl: {}, // ThumbmarkJS itself reported nothing for renderer here
        audio: "A",
        hardware: {}, // no cores from ThumbmarkJS either
        system: {}, // no platform from ThumbmarkJS
      },
      info: {},
      version: "1.9.0",
    } as never);

    const fakeGl = {
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_VENDOR_WEBGL: "VENDOR_ENUM", UNMASKED_RENDERER_WEBGL: "RENDERER_ENUM" }
          : null,
      getParameter: (param: string) =>
        param === "VENDOR_ENUM" ? "Google Inc. (NVIDIA)" : "ANGLE (NVIDIA GeForce RTX 3080)",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeGl as never);
    vi.stubGlobal("navigator", {
      ...navigator,
      hardwareConcurrency: 16,
      platform: "Win32",
      languages: ["en-US", "en"],
    });

    const { generateFingerprintData } = await import("./fingerprint");
    const result = await generateFingerprintData();

    expect(result.components.webglVendor).toBe("Google Inc. (NVIDIA)");
    expect(result.components.webglRenderer).toBe("ANGLE (NVIDIA GeForce RTX 3080)");
    expect(result.components.cores).toBe(16);
    expect(result.components.platform).toBe("Win32");
    expect(result.components.languages).toBe("en-US,en");

    vi.unstubAllGlobals();
  });

  it("never fabricates a WebGL anchor when the probe is blocked/unsupported (degenerate guard stays intact)", async () => {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    vi.mocked(getThumbmark).mockResolvedValue({
      thumbmark: "hash3",
      components: { canvas: { commonImageDataHash: "C" }, webgl: {}, audio: "A" },
      info: {},
      version: "1.9.0",
    } as never);
    // Blocked/unsupported WebGL: getContext returns null (privacy-hardened browser, headless CI, etc).
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);

    const { generateFingerprintData } = await import("./fingerprint");
    const result = await generateFingerprintData();

    expect(result.components.webglVendor).toBeUndefined();
    expect(result.components.webglRenderer).toBeUndefined();
  });

  it("prefers ThumbmarkJS's own webglRenderer when the direct probe is unavailable", async () => {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    vi.mocked(getThumbmark).mockResolvedValue({
      thumbmark: "hash4",
      components: {
        canvas: { commonImageDataHash: "C" },
        webgl: { renderer: "Apple GPU" },
        audio: "A",
      },
      info: {},
      version: "1.9.0",
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);

    const { generateFingerprintData } = await import("./fingerprint");
    const result = await generateFingerprintData();

    expect(result.components.webglRenderer).toBe("Apple GPU");
    expect(result.components.webglVendor).toBeUndefined();
  });
});
