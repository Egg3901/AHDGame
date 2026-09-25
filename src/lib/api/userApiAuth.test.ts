import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { generateUserApiToken } from "./userApiAuth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function mockDb(updateOne: () => Promise<unknown>) {
  return import("@/lib/mongodb").then(({ getDb }) =>
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          userId: new ObjectId(),
          scope: "public",
        }),
        updateOne: vi.fn().mockImplementation(updateOne),
      }),
    } as never)
  );
}

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

  describe("requireUserApiKey", () => {
    it("still authenticates when the background stats write rejects", async () => {
      await mockDb(() => Promise.reject(new Error("mongo down")));
      const { requireUserApiKey } = await import("./userApiAuth");

      const request = new Request("http://localhost", {
        headers: { "X-API-Key": "ahd_pub_abc123" },
      });
      const result = await requireUserApiKey(request, "public");

      expect(result.ok).toBe(true);
      // Let the fire-and-forget write settle inside this test. If the route
      // ever drops its .catch, this surfaces as an unhandled rejection.
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("still validates when the background stats write rejects", async () => {
      await mockDb(() => Promise.reject(new Error("mongo down")));
      const { validateUserApiKey } = await import("./userApiAuth");

      const request = new Request("http://localhost", {
        headers: { "X-API-Key": "ahd_pub_abc123" },
      });
      const result = await validateUserApiKey(request);

      expect(result.valid).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
