import { describe, expect, it } from "vitest";
import { hasAuthorizedPostSovietTransition } from "./postSovietTransition";

describe("post-Soviet constitutional transition", () => {
  it("does not turn the historical date into consent", () => {
    expect(hasAuthorizedPostSovietTransition(145, undefined, undefined)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, 48, undefined)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, undefined, 120)).toBe(false);
  });

  it("requires both enacted markers to be effective", () => {
    expect(hasAuthorizedPostSovietTransition(145, 48, 146)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, 146, 120)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, 48, 120)).toBe(true);
  });

  it("rejects malformed or uncommitted markers", () => {
    expect(hasAuthorizedPostSovietTransition(145, 0, 120)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, 48, -1)).toBe(false);
    expect(hasAuthorizedPostSovietTransition(145, Number.NaN, 120)).toBe(false);
  });
});
