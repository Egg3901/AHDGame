import { describe, expect, it } from "vitest";
import { advanceProductLifecycle, type ProductLifecycleReceipt } from "./productLifecycle";

const product = {
  id: "product-1",
  stage: "development" as const,
  stageStartedTurn: 10,
  startedTurn: 10,
  lastProcessedTurn: 10,
  developmentPaidAnchor: 40,
  paidThresholdAnchor: 100,
  elapsedDevelopmentTurns: 2,
  elapsedThresholdTurns: 3,
};

function receipt(overrides: Partial<ProductLifecycleReceipt> = {}): ProductLifecycleReceipt {
  return { productId: "product-1", turn: 11, paidDevelopmentAnchor: 0, ...overrides };
}

describe("shared product lifecycle", () => {
  it("accepts a zero-cash settled turn for elapsed time without meeting an unpaid cost", () => {
    const progress = advanceProductLifecycle({ product, receipt: receipt() });

    expect(progress).toMatchObject({
      stage: "development",
      developmentPaidAnchor: 40,
      elapsedDevelopmentTurns: 3,
      lastProcessedTurn: 11,
      active: true,
    });
  });

  it("enters launch only when settled spend and elapsed development both clear their thresholds", () => {
    const underElapsed = advanceProductLifecycle({
      product: { ...product, elapsedDevelopmentTurns: 1 },
      receipt: receipt({ paidDevelopmentAnchor: 100 }),
    });
    const underPaid = advanceProductLifecycle({
      product: { ...product, elapsedDevelopmentTurns: 2 },
      receipt: receipt({ paidDevelopmentAnchor: 20 }),
    });
    const ready = advanceProductLifecycle({
      product: { ...product, developmentPaidAnchor: 80 },
      receipt: receipt({ paidDevelopmentAnchor: 20 }),
    });

    expect(underElapsed?.stage).toBe("development");
    expect(underPaid?.stage).toBe("development");
    expect(ready).toMatchObject({
      stage: "launch",
      stageStartedTurn: 11,
      developmentPaidAnchor: 100,
      elapsedDevelopmentTurns: 3,
    });
  });

  it("rejects another product and duplicate or earlier turn receipts", () => {
    expect(
      advanceProductLifecycle({ product, receipt: receipt({ productId: "product-2" }) })
    ).toBeNull();
    expect(advanceProductLifecycle({ product, receipt: receipt({ turn: 10 }) })).toBeNull();
    expect(advanceProductLifecycle({ product, receipt: receipt({ turn: 9 }) })).toBeNull();
  });

  it("fails closed on invalid spend requirements, elapsed thresholds, stamps, and receipts", () => {
    expect(
      advanceProductLifecycle({
        product: { ...product, paidThresholdAnchor: 0 },
        receipt: receipt({ paidDevelopmentAnchor: 1_000 }),
      })
    ).toBeNull();
    expect(
      advanceProductLifecycle({
        product: { ...product, paidThresholdAnchor: Number.NaN },
        receipt: receipt({ paidDevelopmentAnchor: 1_000 }),
      })
    ).toBeNull();
    expect(
      advanceProductLifecycle({
        product: { ...product, elapsedThresholdTurns: Number.NaN },
        receipt: receipt({ paidDevelopmentAnchor: 1_000 }),
      })
    ).toBeNull();
    expect(
      advanceProductLifecycle({
        product: { ...product, stageStartedTurn: Number.POSITIVE_INFINITY },
        receipt: receipt({ paidDevelopmentAnchor: 1_000 }),
      })
    ).toBeNull();
    expect(
      advanceProductLifecycle({
        product,
        receipt: receipt({ paidDevelopmentAnchor: Number.NaN }),
      })
    ).toBeNull();
  });

  it("advances only one lifecycle stage from each accepted receipt", () => {
    const progress = advanceProductLifecycle({
      product: {
        ...product,
        stage: "launch",
        stageStartedTurn: 10,
        developmentPaidAnchor: 100,
        elapsedDevelopmentTurns: 3,
        elapsedThresholdTurns: 3,
      },
      receipt: receipt({ turn: 1000 }),
    });

    expect(progress).toMatchObject({ stage: "growth", stageStartedTurn: 1000, active: true });
  });

  it("retires after the final stage duration", () => {
    const progress = advanceProductLifecycle({
      product: {
        ...product,
        stage: "decline",
        stageStartedTurn: 10,
        developmentPaidAnchor: 100,
        elapsedDevelopmentTurns: 3,
        elapsedThresholdTurns: 3,
      },
      receipt: receipt({ turn: 69 }),
    });

    expect(progress).toMatchObject({ stage: "retired", stageStartedTurn: 69, active: false });
  });
});
