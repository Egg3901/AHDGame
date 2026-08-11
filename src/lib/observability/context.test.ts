import { describe, it, expect, vi, beforeEach } from "vitest";

const setUser = vi.fn();
const setTags = vi.fn();
const setTag = vi.fn();
const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  setUser: (...a: unknown[]) => setUser(...a),
  setTags: (...a: unknown[]) => setTags(...a),
  setTag: (...a: unknown[]) => setTag(...a),
  captureException: (...a: unknown[]) => captureException(...a),
}));

import { setUserContext, voidWithCapture, runWithCapture, refundOrCapture } from "./context";

describe("observability/context", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("setUserContext", () => {
    it("sets user id + username and role tags, never email", () => {
      setUserContext({
        userId: "u1",
        username: "alice",
        email: "alice@example.com",
        role: "user",
        isModerator: true,
      } as never);
      expect(setUser).toHaveBeenCalledWith({ id: "u1", username: "alice" });
      const tags = setTags.mock.calls[0][0];
      expect(tags["user.role"]).toBe("user");
      expect(tags["user.isModerator"]).toBe(true);
      // Email must not be sent anywhere
      const allArgs = JSON.stringify([setUser.mock.calls, setTags.mock.calls, setTag.mock.calls]);
      expect(allArgs).not.toContain("alice@example.com");
    });

    it("tags character + country when a character is present", () => {
      setUserContext({
        userId: "u2",
        username: "bob",
        role: "user",
        character: { _id: { toString: () => "char99" }, countryId: "US" },
      } as never);
      expect(setTag).toHaveBeenCalledWith("character.id", "char99");
      expect(setTag).toHaveBeenCalledWith("country.id", "US");
    });
  });

  describe("voidWithCapture", () => {
    it("captures a rejection with the provided tags/extra", async () => {
      const err = new Error("boom");
      voidWithCapture(Promise.reject(err), { tags: { module: "x" }, extra: { id: 1 } });
      await new Promise((r) => setTimeout(r, 0));
      expect(captureException).toHaveBeenCalledWith(err, {
        level: "error",
        tags: { module: "x" },
        extra: { id: 1 },
      });
    });

    it("does not capture on success", async () => {
      voidWithCapture(Promise.resolve("ok"), { tags: { module: "x" } });
      await new Promise((r) => setTimeout(r, 0));
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("runWithCapture", () => {
    it("returns the value on success without capturing", async () => {
      const out = await runWithCapture(async () => 42, { tags: { module: "y" } });
      expect(out).toBe(42);
      expect(captureException).not.toHaveBeenCalled();
    });

    it("captures and returns the fallback on failure", async () => {
      const out = await runWithCapture(
        async () => {
          throw new Error("nope");
        },
        { tags: { module: "y" } },
        "fallback"
      );
      expect(out).toBe("fallback");
      expect(captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe("refundOrCapture", () => {
    it("runs the refund and captures nothing on success", async () => {
      const refund = vi.fn().mockResolvedValue(undefined);
      await refundOrCapture(refund, { tags: { component: "bonds.buy" } });
      expect(refund).toHaveBeenCalledTimes(1);
      expect(captureException).not.toHaveBeenCalled();
    });

    it("captures at fatal with refund_after_debit when the refund itself fails", async () => {
      const refundErr = new Error("refund failed");
      await refundOrCapture(() => Promise.reject(refundErr), {
        tags: { component: "bonds.buy", buyer: "character" },
        extra: { characterId: "c1" },
      });
      expect(captureException).toHaveBeenCalledWith(refundErr, {
        level: "fatal",
        tags: { failure: "refund_after_debit", component: "bonds.buy", buyer: "character" },
        extra: { characterId: "c1" },
      });
    });
  });
});
