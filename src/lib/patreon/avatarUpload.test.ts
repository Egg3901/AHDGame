import { describe, it, expect } from "vitest";
import { canUploadGifAvatar } from "./avatarUpload";

describe("canUploadGifAvatar", () => {
  it("allows supporter and supporter-plus when subscription is active", () => {
    expect(canUploadGifAvatar("supporter", null)).toBe(true);
    expect(canUploadGifAvatar("supporter-plus", null)).toBe(true);
  });

  it("rejects when tier is null or expired", () => {
    expect(canUploadGifAvatar(null, null)).toBe(false);
    const past = new Date(Date.now() - 86400000);
    expect(canUploadGifAvatar("supporter", past)).toBe(false);
  });

  it("accepts ISO date strings for expiry", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(canUploadGifAvatar("supporter", future)).toBe(true);
  });
});
