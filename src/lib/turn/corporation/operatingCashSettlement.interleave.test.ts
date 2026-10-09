import { describe, expect, it } from "vitest";
import { interleaveByKey } from "./operatingCashSettlement";

describe("interleaveByKey", () => {
  it("alternates buckets so concurrent lanes start on different keys", () => {
    const items = ["US1", "US2", "US3", "UK1", "UK2", "JP1"];
    expect(interleaveByKey(items, (item) => item.slice(0, 2))).toEqual([
      "US1",
      "UK1",
      "JP1",
      "US2",
      "UK2",
      "US3",
    ]);
  });

  it("keeps every item exactly once and each bucket in input order", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({ index, key: `k${index % 7}` }));
    const ordered = interleaveByKey(items, (item) => item.key);
    expect(ordered.map((item) => item.index).sort((a, b) => a - b)).toEqual(
      items.map((item) => item.index)
    );
    for (const key of new Set(items.map((item) => item.key))) {
      const indexes = ordered.filter((item) => item.key === key).map((item) => item.index);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
  });

  it("handles an empty input", () => {
    expect(interleaveByKey([], () => "x")).toEqual([]);
  });
});
