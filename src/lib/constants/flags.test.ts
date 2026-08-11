import { describe, expect, it } from "vitest";
import { STATE_FLAGS, resolveCountryFlagCode, getCountryFlagUrl } from "./flags";

// Wikimedia rejects thumbnail requests whose width is not on its standard
// allowlist (HTTP 400, "Use thumbnail sizes listed on ...").
// See https://www.mediawiki.org/wiki/Common_thumbnail_sizes
const ALLOWED_WIKIMEDIA_THUMB_WIDTHS = new Set([
  20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840,
]);

describe("STATE_FLAGS", () => {
  const entries = Object.entries(STATE_FLAGS);

  it("has at least the 50 states plus DC and the UK regions", () => {
    expect(entries.length).toBeGreaterThanOrEqual(51);
  });

  it("only requests Wikimedia thumbnails at allowed widths", () => {
    const offenders: string[] = [];
    for (const [code, url] of entries) {
      const match = url.match(/\/thumb\/.*\/(\d+)px-/);
      if (!match) continue; // non-thumb URLs are unaffected by the width allowlist
      const width = Number(match[1]);
      if (!ALLOWED_WIKIMEDIA_THUMB_WIDTHS.has(width)) {
        offenders.push(`${code}: ${width}px`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("resolveCountryFlagCode", () => {
  it("maps the UK to GB", () => {
    expect(resolveCountryFlagCode("UK")).toBe("GB");
  });

  it("maps UK devolved nations to flagcdn GB subdivision codes (not 404 'sco'/'wal')", () => {
    // flagcdn serves gb-sct/gb-wls/gb-nir; plain sco/wal/nir 404 → broken emblem.
    expect(resolveCountryFlagCode("SCO")).toBe("GB-SCT");
    expect(resolveCountryFlagCode("WAL")).toBe("GB-WLS");
    expect(resolveCountryFlagCode("NIR")).toBe("GB-NIR");
  });

  it("passes through an unmapped ISO code", () => {
    expect(resolveCountryFlagCode("ie")).toBe("IE");
  });
});

describe("getCountryFlagUrl", () => {
  it("builds a lowercase flagcdn URL for a devolved nation", () => {
    expect(getCountryFlagUrl("SCO")).toBe("https://flagcdn.com/w640/gb-sct.png");
    expect(getCountryFlagUrl("WAL")).toBe("https://flagcdn.com/w640/gb-wls.png");
  });
});
