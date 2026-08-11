import { describe, expect, it } from "vitest";
import { generateUserApiToken } from "./userApiAuth";

describe("userApiAuth", () => {
  describe("generateUserApiToken", () => {
    it("generates a public key with ahd_pub_ prefix", () => {
      const result = generateUserApiToken("public");
      expect(result.token).toMatch(/^ahd_pub_/);
      expect(result.token.length).toBeGreaterThan(14);
      expect(result.prefix).toBe(result.token.slice(0, 14));
      expect(result.tokenHash).toBeTruthy();
    });

    it("generates a private key with ahd_priv_ prefix", () => {
      const result = generateUserApiToken("private");
      expect(result.token).toMatch(/^ahd_priv_/);
      expect(result.token.length).toBeGreaterThan(15);
      expect(result.prefix).toBe(result.token.slice(0, 14));
      expect(result.tokenHash).toBeTruthy();
    });

    it("generates unique tokens each call", () => {
      const a = generateUserApiToken("public");
      const b = generateUserApiToken("public");
      expect(a.token).not.toBe(b.token);
      expect(a.tokenHash).not.toBe(b.tokenHash);
    });

    it("produces different hashes for different scopes", () => {
      const pub = generateUserApiToken("public");
      const priv = generateUserApiToken("private");
      expect(pub.tokenHash).not.toBe(priv.tokenHash);
      expect(pub.prefix).not.toBe(priv.prefix);
    });
  });
});
