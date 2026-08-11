import { describe, expect, it } from "vitest";
import { getRegistrationIpMatchCandidates, normalizeIp } from "./ipNormalize";

describe("normalizeIp", () => {
  it("returns null for empty string", () => {
    expect(normalizeIp("")).toBeNull();
  });

  it("returns null for the 'unknown' sentinel", () => {
    expect(normalizeIp("unknown")).toBeNull();
  });

  it("trims whitespace from IPv4", () => {
    expect(normalizeIp("  1.2.3.4  ")).toBe("1.2.3.4");
  });

  it("returns IPv4 unchanged when already normalized", () => {
    expect(normalizeIp("10.0.0.1")).toBe("10.0.0.1");
  });

  it("lowercases IPv6", () => {
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("collapses IPv4-mapped IPv6 to bare IPv4", () => {
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("::FFFF:1.2.3.4")).toBe("1.2.3.4");
  });

  it("returns null for obviously invalid input", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("999.999.999.999")).toBeNull();
  });
});

describe("getRegistrationIpMatchCandidates", () => {
  it("includes both bare IPv4 and mapped IPv6 legacy forms", () => {
    expect(getRegistrationIpMatchCandidates("1.2.3.4")).toEqual([
      "1.2.3.4",
      "::ffff:1.2.3.4",
      "::FFFF:1.2.3.4",
    ]);
  });

  it("retains trimmed legacy raw forms for case-sensitive exact matches", () => {
    expect(getRegistrationIpMatchCandidates("::FFFF:1.2.3.4")).toEqual([
      "1.2.3.4",
      "::FFFF:1.2.3.4",
      "::ffff:1.2.3.4",
    ]);
  });

  it("returns an empty list for unparseable values", () => {
    expect(getRegistrationIpMatchCandidates("unknown")).toEqual([]);
  });
});
