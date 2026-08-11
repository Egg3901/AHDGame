import { describe, it, expect } from "vitest";

describe("isForexEnabled", () => {
  it("always returns true (forex is permanently enabled)", async () => {
    const { isForexEnabled } = await import("./featureFlag");
    expect(await isForexEnabled()).toBe(true);
    expect(await isForexEnabled({ forexEnabled: false })).toBe(true);
    expect(await isForexEnabled({ forexEnabled: true })).toBe(true);
  });
});
