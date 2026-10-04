import { describe, expect, it } from "vitest";
import { getPath, scaleDeep, setPath } from "./docScale";

describe("document path helpers", () => {
  it("rejects prototype-polluting segments at every depth", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "__proto__.polluted", true);
    setPath(target, "safe.__proto__.polluted", true);
    setPath(target, "safe.constructor.prototype.polluted", true);
    setPath(target, "safe.prototype.polluted", true);

    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(target).toEqual({});
    expect(getPath(target, "__proto__")).toBeUndefined();
    expect(getPath(target, "safe.constructor.prototype")).toBeUndefined();
  });

  it("creates arrays for numeric path segments and reads their values", () => {
    const target: Record<string, unknown> = {};

    setPath(target, "groups.0.population", 12);

    expect(target).toEqual({ groups: [{ population: 12 }] });
    expect(getPath(target, "groups.0.population")).toBe(12);
  });
});

describe("scaleDeep", () => {
  it("preserves literal __proto__ data without changing object prototypes", () => {
    const source = JSON.parse('{"__proto__":{"population":4},"safe":{"value":3}}') as Record<
      string,
      unknown
    >;

    const scaled = scaleDeep(source, 2) as Record<string, unknown>;
    const literalProto = Object.getOwnPropertyDescriptor(scaled, "__proto__");

    expect(Object.getPrototypeOf(scaled)).toBe(Object.prototype);
    expect(literalProto?.enumerable).toBe(true);
    expect(literalProto?.value).toEqual({ population: 8 });
    expect(scaled.safe).toEqual({ value: 6 });
    expect(Object.prototype).not.toHaveProperty("population");
  });
});
