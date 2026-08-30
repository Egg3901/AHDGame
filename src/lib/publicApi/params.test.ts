import { describe, expect, it } from "vitest";
import { parseBoundedInt } from "./params";

describe("parseBoundedInt", () => {
  const options = { name: "limit", defaultValue: 20, min: 1, max: 200 };

  it("uses the default for an omitted value", () => {
    expect(parseBoundedInt(null, options)).toEqual({ ok: true, value: 20 });
  });

  it("accepts bounded integers", () => {
    expect(parseBoundedInt("50", options)).toEqual({ ok: true, value: 50 });
  });

  it.each(["1.5", "-1", "NaN", "201"])("rejects invalid input %s", (raw) => {
    expect(parseBoundedInt(raw, options).ok).toBe(false);
  });
});
