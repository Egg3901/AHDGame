import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addOperatingModelPersistent,
  retireProductPersistent,
  startProductPersistent,
} from "@/lib/products/persistence";
import { executeNppProductDecision } from "./nppProductExecutor";

vi.mock("@/lib/products/persistence", () => ({
  addOperatingModelPersistent: vi.fn(),
  retireProductPersistent: vi.fn(),
  startProductPersistent: vi.fn(),
}));

const db = {} as never;

describe("executeNppProductDecision", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, { kind: "none", reason: "below_v4" } as const])(
    "does no writes for a missing or neutral decision",
    async (decision) => {
      await expect(
        executeNppProductDecision(db, {
          enabled: true,
          corporationId: "corp-1",
          turn: 7,
          decision,
        })
      ).resolves.toEqual({ kind: "noop" });
      expect(startProductPersistent).not.toHaveBeenCalled();
      expect(addOperatingModelPersistent).not.toHaveBeenCalled();
      expect(retireProductPersistent).not.toHaveBeenCalled();
    }
  );

  it("does no writes when the launch gate is off", async () => {
    await executeNppProductDecision(db, {
      enabled: false,
      corporationId: "corp-1",
      turn: 7,
      decision: {
        kind: "start_product",
        kindId: "passenger_car",
        name: "Passenger Car",
        maxSpendLocal: 10,
      },
    });
    expect(startProductPersistent).not.toHaveBeenCalled();
  });

  it("acquires an operating model through the idempotent persistence command", async () => {
    vi.mocked(addOperatingModelPersistent).mockResolvedValue({
      ok: true,
      model: {
        _id: "corp-1:radio_network",
        corporationId: "corp-1",
        operatingModel: "radio_network",
        acquiredTurn: 7,
      },
    });
    await executeNppProductDecision(db, {
      enabled: true,
      corporationId: "corp-1",
      turn: 7,
      decision: {
        kind: "acquire_operating_model",
        operatingModel: "radio_network",
        maxSpendLocal: 10,
      },
    });
    expect(addOperatingModelPersistent).toHaveBeenCalledWith(db, {
      enabled: true,
      corporationId: "corp-1",
      operatingModel: "radio_network",
      turn: 7,
    });
  });

  it("starts a product with a deterministic retry-safe id", async () => {
    vi.mocked(startProductPersistent).mockResolvedValue({ ok: false, reason: "active_product" });
    await executeNppProductDecision(db, {
      enabled: true,
      corporationId: "corp-1",
      turn: 7,
      decision: {
        kind: "start_product",
        kindId: "passenger_car",
        name: "Passenger Car",
        maxSpendLocal: 10,
      },
    });
    expect(startProductPersistent).toHaveBeenCalledWith(db, {
      enabled: true,
      draft: {
        id: "npp:corp-1:7:passenger_car",
        corporationId: "corp-1",
        kindId: "passenger_car",
        name: "Passenger Car",
        startedTurn: 7,
      },
    });
  });

  it("retires through the atomic slot-freeing command", async () => {
    vi.mocked(retireProductPersistent).mockResolvedValue({ ok: false, reason: "already_retired" });
    await executeNppProductDecision(db, {
      enabled: true,
      corporationId: "corp-1",
      turn: 7,
      decision: { kind: "retire_product", productId: "product-1", failingTurns: 12 },
    });
    expect(retireProductPersistent).toHaveBeenCalledWith(db, { productId: "product-1", turn: 7 });
  });
});
