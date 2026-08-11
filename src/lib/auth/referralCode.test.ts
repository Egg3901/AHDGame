import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { OAUTH_REFERRAL_CODE_COOKIE } from "@/lib/auth/oauthFingerprint";
import { normalizeReferralCode } from "./normalizeReferralCode";
import { resolveReferredByFromOAuthCookie } from "./referralCode";

describe("normalizeReferralCode", () => {
  const valid = "a1b2c3d4e5f6789012345678";

  it("accepts a lowercase ObjectId", () => {
    expect(normalizeReferralCode(valid)).toBe(valid);
  });

  it("lowercases and trims", () => {
    expect(normalizeReferralCode(`  ${valid.toUpperCase()}  `)).toBe(valid);
  });

  it("decodes URI-encoded cookie values", () => {
    expect(normalizeReferralCode(encodeURIComponent(valid))).toBe(valid);
  });

  it("rejects non-ObjectId strings", () => {
    expect(normalizeReferralCode("not-a-code")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeReferralCode("a1b2c3d4e5f678901234567")).toBeNull(); // 23 chars
  });
});

describe("resolveReferredByFromOAuthCookie", () => {
  it("returns the referrer ObjectId and clears the cookie", async () => {
    const referrerId = new ObjectId();
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: referrerId.toHexString() }),
      delete: vi.fn(),
    };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue({ _id: referrerId }),
    };

    const result = await resolveReferredByFromOAuthCookie(cookieStore, usersCollection);

    expect(result?.equals(referrerId)).toBe(true);
    expect(cookieStore.get).toHaveBeenCalledWith(OAUTH_REFERRAL_CODE_COOKIE);
    expect(cookieStore.delete).toHaveBeenCalledWith(OAUTH_REFERRAL_CODE_COOKIE);
  });

  it("returns undefined for an unknown code without blocking", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "a1b2c3d4e5f6789012345678" }),
      delete: vi.fn(),
    };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    await expect(resolveReferredByFromOAuthCookie(cookieStore, usersCollection)).resolves.toBe(
      undefined
    );
    expect(cookieStore.delete).toHaveBeenCalled();
  });

  it("returns undefined when the cookie is missing", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue(undefined),
      delete: vi.fn(),
    };
    const usersCollection = {
      findOne: vi.fn(),
    };

    await expect(resolveReferredByFromOAuthCookie(cookieStore, usersCollection)).resolves.toBe(
      undefined
    );
    expect(usersCollection.findOne).not.toHaveBeenCalled();
  });
});
