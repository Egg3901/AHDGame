import { describe, expect, it } from "vitest";
import { CHROME_HIDDEN_PATHS, isChromeHiddenPath } from "./layoutPaths";

describe("isChromeHiddenPath", () => {
  it.each(CHROME_HIDDEN_PATHS)("hides chrome on %s", (pathname) => {
    expect(isChromeHiddenPath(pathname)).toBe(true);
  });

  it("leaves an ordinary page alone", () => {
    expect(isChromeHiddenPath("/world")).toBe(false);
  });

  // Exact match, not prefix: "/login" must not swallow a sibling route that
  // merely starts with the same characters.
  it("does not match a path that only starts with an excluded one", () => {
    expect(isChromeHiddenPath("/loginhelp")).toBe(false);
  });

  it("does not match a subtree of an excluded path", () => {
    expect(isChromeHiddenPath("/register/step-2")).toBe(false);
  });

  it("treats a missing pathname as an ordinary page", () => {
    expect(isChromeHiddenPath(null)).toBe(false);
    expect(isChromeHiddenPath(undefined)).toBe(false);
  });
});
