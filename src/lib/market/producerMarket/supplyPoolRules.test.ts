import { describe, expect, it } from "vitest";
import { ProducerSupplyPool } from "./supplyPoolRules";

describe("pooled physical supply", () => {
  it("retains a small supplier after a much larger supplier withdraws", () => {
    const pool = new ProducerSupplyPool();
    pool.add("large", 1e20);
    pool.add("small", 1);
    pool.setRemaining("large", 0);
    expect(pool.total).toBe(1);
    pool.take(0.5);
    expect(pool.remaining("small")).toBe(0.5);
    expect(pool.pooledSold("small")).toBe(0.5);
    expect(pool.activeCount).toBe(1);
  });

  it("records a small sale even when subtracting it from huge physical stock would round away", () => {
    const pool = new ProducerSupplyPool();
    pool.add("large", 1e20);
    pool.take(1);
    expect(pool.pooledSold("large")).toBe(1);
  });

  it("separates pooled sales from later direct and internal withdrawals", () => {
    const pool = new ProducerSupplyPool();
    pool.add("a", 10);
    pool.add("b", 10);
    pool.take(4);
    pool.setRemaining("a", 0);
    pool.take(4);
    expect(pool.pooledSold("a")).toBe(2);
    expect(pool.pooledSold("b")).toBeCloseTo(6, 12);
    expect(pool.remaining("b")).toBeCloseTo(4, 12);
    expect(pool.total).toBeCloseTo(4, 12);
  });
});
