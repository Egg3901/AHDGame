import { describe, expect, it } from "vitest";
import { startProductDevelopment } from "./lifecycle";
import type { CorporationProduct, ProductDraft } from "./types";

const draft: ProductDraft = {
  id: "product-1",
  corporationId: "corp-1",
  kindId: "passenger_car",
  name: "Model One",
  startedTurn: 100,
};

function active(stage: CorporationProduct["stage"]): CorporationProduct {
  return {
    ...draft,
    stage,
    developmentSpendAnchor: 10,
    developmentAdvertisingAnchor: 5,
    developmentAdvertisingTurns: 1,
  };
}

describe("startProductDevelopment", () => {
  it("is neutral while the next-iteration feature is disabled", () => {
    expect(startProductDevelopment({ enabled: false, activeProduct: null, draft })).toEqual({
      ok: false,
      reason: "feature_disabled",
    });
  });

  it("starts a known product with neutral development balances", () => {
    expect(startProductDevelopment({ enabled: true, activeProduct: null, draft })).toEqual({
      ok: true,
      product: {
        ...draft,
        stage: "development",
        developmentSpendAnchor: 0,
        developmentAdvertisingAnchor: 0,
        developmentAdvertisingTurns: 0,
      },
    });
  });

  it.each(["development", "launch", "growth", "mature", "decline"] as const)(
    "enforces one active product when the existing product is %s",
    (stage) => {
      expect(
        startProductDevelopment({ enabled: true, activeProduct: active(stage), draft })
      ).toEqual({ ok: false, reason: "active_product" });
    }
  );

  it("allows a new product after retirement", () => {
    expect(
      startProductDevelopment({ enabled: true, activeProduct: active("retired"), draft }).ok
    ).toBe(true);
  });

  it("rejects product kinds outside the canonical catalog", () => {
    expect(
      startProductDevelopment({
        enabled: true,
        activeProduct: null,
        draft: { ...draft, kindId: "bus" },
      })
    ).toEqual({ ok: false, reason: "unknown_product_kind" });
  });
});
