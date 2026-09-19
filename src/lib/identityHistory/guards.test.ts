import { describe, expect, it } from "vitest";
import { isGroupableIdentityValue } from "./guards";

describe("isGroupableIdentityValue", () => {
  it("accepts an ordinary residential IP", () => {
    expect(isGroupableIdentityValue("ip", "68.192.35.139")).toBe(true);
  });

  it("rejects the unresolved-IP sentinel", () => {
    expect(isGroupableIdentityValue("ip", "unknown")).toBe(false);
  });

  it("rejects loopback addresses", () => {
    expect(isGroupableIdentityValue("ip", "127.0.0.1")).toBe(false);
    expect(isGroupableIdentityValue("ip", "::1")).toBe(false);
  });

  it("rejects a Cloudflare edge address", () => {
    expect(isGroupableIdentityValue("ip", "173.245.48.1")).toBe(false);
  });

  it("accepts an ordinary fingerprint hash", () => {
    expect(isGroupableIdentityValue("fingerprint", "10f9219d43944d1ec95b59b6135395b7")).toBe(true);
  });

  it("rejects a degenerate fingerprint placeholder", () => {
    expect(isGroupableIdentityValue("fingerprint", "server-side")).toBe(false);
    expect(isGroupableIdentityValue("fingerprint", "unknown")).toBe(false);
  });

  it("rejects empty and nullish values on both tracks", () => {
    expect(isGroupableIdentityValue("ip", "")).toBe(false);
    expect(isGroupableIdentityValue("ip", null)).toBe(false);
    expect(isGroupableIdentityValue("fingerprint", undefined)).toBe(false);
  });
});
