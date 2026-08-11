import { describe, it, expect } from "vitest";
import {
  getCfFingerprint,
  isEmptyCfFingerprint,
  isHighBotScoreFlag,
  maskJa4,
  type HeaderGetter,
} from "./cfFingerprint";

function headers(map: Record<string, string>): HeaderGetter {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

describe("getCfFingerprint", () => {
  it("returns {} when no Cloudflare headers are present (local dev / graceful degradation)", () => {
    expect(getCfFingerprint(headers({}))).toEqual({});
  });

  it("captures the country code, uppercased", () => {
    expect(getCfFingerprint(headers({ "cf-ipcountry": "us" }))).toEqual({ country: "US" });
  });

  it("drops Cloudflare's XX (unknown) and T1 (Tor) country sentinels", () => {
    expect(getCfFingerprint(headers({ "cf-ipcountry": "XX" }))).toEqual({});
    expect(getCfFingerprint(headers({ "cf-ipcountry": "T1" }))).toEqual({});
  });

  it("captures ASN when a Transform Rule exposes cf-asn", () => {
    expect(getCfFingerprint(headers({ "cf-asn": "AS15169" }))).toEqual({ asn: "AS15169" });
  });

  it("falls back to the x-cf-asn alias when cf-asn is absent", () => {
    expect(getCfFingerprint(headers({ "x-cf-asn": "AS13335" }))).toEqual({ asn: "AS13335" });
  });

  it("captures colo directly from cf-colo when present", () => {
    expect(getCfFingerprint(headers({ "cf-colo": "LAX" }))).toEqual({ colo: "LAX" });
  });

  it("parses colo from the cf-ray suffix when no explicit colo header exists", () => {
    expect(getCfFingerprint(headers({ "cf-ray": "7f9a2b3c4d5e6f70-LAX" }))).toEqual({
      colo: "LAX",
    });
  });

  it("ignores a malformed cf-ray with no valid trailing colo code", () => {
    expect(getCfFingerprint(headers({ "cf-ray": "not-a-ray-id" }))).toEqual({});
  });

  it("captures JA4 when present", () => {
    expect(getCfFingerprint(headers({ "cf-ja4": "t13d1516h2_8daaf6152771" }))).toEqual({
      ja4: "t13d1516h2_8daaf6152771",
    });
  });

  it("falls back to JA3 when only that header is exposed (same field, per the signal's design)", () => {
    expect(getCfFingerprint(headers({ "cf-ja3-hash": "abc123ja3hash" }))).toEqual({
      ja4: "abc123ja3hash",
    });
  });

  it("prefers JA4 over JA3 when both are present", () => {
    expect(getCfFingerprint(headers({ "cf-ja4": "ja4value", "cf-ja3-hash": "ja3value" }))).toEqual({
      ja4: "ja4value",
    });
  });

  it("captures bot score within the valid 1-99 range", () => {
    expect(getCfFingerprint(headers({ "cf-bot-score": "12" }))).toEqual({ botScore: 12 });
  });

  it("drops an out-of-range or non-numeric bot score", () => {
    expect(getCfFingerprint(headers({ "cf-bot-score": "150" }))).toEqual({});
    expect(getCfFingerprint(headers({ "cf-bot-score": "not-a-number" }))).toEqual({});
  });

  it("captures threat score within the valid 0-100 range", () => {
    expect(getCfFingerprint(headers({ "cf-threat-score": "45" }))).toEqual({ threatScore: 45 });
  });

  it("assembles every field at once when a full Bot Management header set is present", () => {
    expect(
      getCfFingerprint(
        headers({
          "cf-ipcountry": "GB",
          "cf-asn": "AS5089",
          "cf-colo": "LHR",
          "cf-ja4": "t13d1516h2_ja4hash",
          "cf-bot-score": "5",
          "cf-threat-score": "20",
        })
      )
    ).toEqual({
      country: "GB",
      asn: "AS5089",
      colo: "LHR",
      ja4: "t13d1516h2_ja4hash",
      botScore: 5,
      threatScore: 20,
    });
  });
});

describe("isEmptyCfFingerprint", () => {
  it("is true for {}", () => {
    expect(isEmptyCfFingerprint({})).toBe(true);
  });

  it("is false when any field is present", () => {
    expect(isEmptyCfFingerprint({ country: "US" })).toBe(false);
  });
});

describe("isHighBotScoreFlag", () => {
  it("flags a low (bot-like) score", () => {
    expect(isHighBotScoreFlag({ botScore: 5 })).toBe(true);
  });

  it("does not flag a high (human-like) score", () => {
    expect(isHighBotScoreFlag({ botScore: 90 })).toBe(false);
  });

  it("does not flag when no score was captured (graceful degradation)", () => {
    expect(isHighBotScoreFlag({})).toBe(false);
    expect(isHighBotScoreFlag(undefined)).toBe(false);
    expect(isHighBotScoreFlag(null)).toBe(false);
  });
});

describe("maskJa4", () => {
  it("truncates a long hash to a short prefix", () => {
    expect(maskJa4("t13d1516h2_8daaf6152771_abcdef")).toBe("t13d1516h2…");
  });

  it("leaves a short value unmasked apart from the ellipsis", () => {
    expect(maskJa4("short")).toBe("short…");
  });
});
