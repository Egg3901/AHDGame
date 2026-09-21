import { describe, it, expect } from "vitest";
import { isCorporationProductsEnabled, resolveCorporationProductsEnabled } from "./featureFlag";

function fakeDb(config: unknown) {
  return {
    collection: () => ({
      findOne: async () => config,
    }),
  } as never;
}

describe("corporation products feature flag", () => {
  it("resolves true only for an explicit true", () => {
    expect(resolveCorporationProductsEnabled({ corporationProductsEnabled: true })).toBe(true);
    expect(resolveCorporationProductsEnabled({ corporationProductsEnabled: false })).toBe(false);
    expect(resolveCorporationProductsEnabled({})).toBe(false);
    expect(resolveCorporationProductsEnabled(null)).toBe(false);
    expect(resolveCorporationProductsEnabled(undefined)).toBe(false);
  });

  it("reads the gate from gameConfig with a projection", async () => {
    expect(await isCorporationProductsEnabled(fakeDb({ corporationProductsEnabled: true }))).toBe(
      true
    );
    expect(await isCorporationProductsEnabled(fakeDb({}))).toBe(false);
    expect(await isCorporationProductsEnabled(fakeDb(null))).toBe(false);
  });
});
