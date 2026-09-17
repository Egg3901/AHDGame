import { describe, expect, it } from "vitest";
import { deriveMoneyFlowKey, MAX_MONEY_FLOW_KEY_LENGTH } from "./nonAtomicMoneyFlow";

describe("deriveMoneyFlowKey (issue #1672)", () => {
  it("caps every key at the documented accepted limit", () => {
    expect(MAX_MONEY_FLOW_KEY_LENGTH).toBe(128);
  });

  it("preserves ordinary short keys byte-identical to the legacy template form", () => {
    expect(deriveMoneyFlowKey("abc", "holder", "character", "0123456789abcdef01234567")).toBe(
      "abc:holder:character:0123456789abcdef01234567"
    );
    expect(deriveMoneyFlowKey("abc", "compensate", "pool-credit")).toBe(
      "abc:compensate:pool-credit"
    );
    expect(deriveMoneyFlowKey("abc", "leadership-claim")).toBe("abc:leadership-claim");
  });

  it("keeps the exact-fit boundary verbatim and bounds one character past it", () => {
    const suffix = "holder:character:0123456789abcdef01234567";
    const exactBase = "k".repeat(128 - 1 - suffix.length);
    expect(`${exactBase}:${suffix}`).toHaveLength(128);
    expect(deriveMoneyFlowKey(exactBase, "holder", "character", "0123456789abcdef01234567")).toBe(
      `${exactBase}:${suffix}`
    );
    const overBase = `${exactBase}x`;
    expect(`${overBase}:${suffix}`).toHaveLength(129);
    const derived = deriveMoneyFlowKey(overBase, "holder", "character", "0123456789abcdef01234567");
    expect(derived.length).toBeLessThanOrEqual(128);
    expect(derived).not.toBe(`${overBase}:${suffix}`);
  });

  it("bounds a 128-character base with every dissolution-style suffix", () => {
    const base = "k".repeat(128);
    const hex = "0123456789abcdef01234567";
    const derived = [
      deriveMoneyFlowKey(base, "holder", "character", hex),
      deriveMoneyFlowKey(base, "holder", "corp", hex),
      deriveMoneyFlowKey(base, "pool", "USD", "0"),
      deriveMoneyFlowKey(base, "fund", hex),
      deriveMoneyFlowKey(base, "compensate", `holder-credit-character-${hex}`),
      deriveMoneyFlowKey(base, "compensate", "fund"),
    ];
    for (const key of derived) {
      expect(key.length).toBeLessThanOrEqual(128);
    }
    // Nested derivation (compensation of an already-derived subkey) stays bounded too.
    const sub = deriveMoneyFlowKey(base, "holder", "character", hex);
    const nested = deriveMoneyFlowKey(sub, "compensate", `holder-credit-character-${hex}`);
    expect(nested.length).toBeLessThanOrEqual(128);
    // Every derivation is distinct: no two purposes share a key.
    expect(new Set(derived).size).toBe(derived.length);
  });

  it("is deterministic, so a retry rebuilds the same subkeys", () => {
    const base = "k".repeat(128);
    const first = deriveMoneyFlowKey(base, "holder", "character", "0123456789abcdef01234567");
    const second = deriveMoneyFlowKey(base, "holder", "character", "0123456789abcdef01234567");
    expect(second).toBe(first);
    const nested1 = deriveMoneyFlowKey(first, "compensate", "holder-credit-x");
    const nested2 = deriveMoneyFlowKey(
      deriveMoneyFlowKey(base, "holder", "character", "0123456789abcdef01234567"),
      "compensate",
      "holder-credit-x"
    );
    expect(nested2).toBe(nested1);
  });

  it("binds the full candidate: different bases never share a derived key", () => {
    const suffixArgs = ["holder", "character", "0123456789abcdef01234567"] as const;
    const a = deriveMoneyFlowKey("a".repeat(128), ...suffixArgs);
    const b = deriveMoneyFlowKey("b".repeat(128), ...suffixArgs);
    expect(a).not.toBe(b);
    const c = deriveMoneyFlowKey("a".repeat(127) + "b", ...suffixArgs);
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
  });

  it("preserves the purpose suffix for ops readability in the hashed form", () => {
    const derived = deriveMoneyFlowKey("k".repeat(128), "compensate", "pool-credit");
    expect(derived).toContain("compensate:pool-credit");
    expect(derived).toMatch(/:h:[0-9a-f]{32}$/);
  });

  it("bounds even a suffix that nearly fills the cap on its own", () => {
    const derived = deriveMoneyFlowKey("k".repeat(128), "x".repeat(120));
    expect(derived.length).toBeLessThanOrEqual(128);
    expect(derived).toMatch(/:h:[0-9a-f]{32}$/);
    // Still deterministic.
    expect(deriveMoneyFlowKey("k".repeat(128), "x".repeat(120))).toBe(derived);
  });

  it("rejects empty bases, over-limit bases, and empty segments", () => {
    expect(() => deriveMoneyFlowKey("", "holder")).toThrow(RangeError);
    expect(() => deriveMoneyFlowKey("k".repeat(129), "holder")).toThrow(RangeError);
    expect(() => deriveMoneyFlowKey("ok")).toThrow(TypeError);
    expect(() => deriveMoneyFlowKey("ok", "")).toThrow(TypeError);
  });
});
