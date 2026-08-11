import { describe, it, expect } from "vitest";
import { isAutoDisastersEnabled } from "./featureFlag";

describe("isAutoDisastersEnabled", () => {
  it("returns true only when the preloaded flag is true", async () => {
    expect(await isAutoDisastersEnabled({ autoDisastersEnabled: true })).toBe(true);
  });

  it("returns false when the preloaded flag is false or missing", async () => {
    expect(await isAutoDisastersEnabled({ autoDisastersEnabled: false })).toBe(false);
    expect(await isAutoDisastersEnabled({})).toBe(false);
  });
});
