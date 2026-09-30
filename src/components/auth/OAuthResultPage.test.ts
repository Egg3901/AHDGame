import { describe, expect, it } from "vitest";
import { safeResultNext } from "./OAuthResultPage";

describe("safeResultNext", () => {
  it("keeps same-site paths and the vetted Lakeside continuation", () => {
    expect(safeResultNext("/profile")).toBe("/profile");
    expect(safeResultNext("/create-character?x=1")).toBe("/create-character?x=1");
    const lakeside = "https://auth.ahousedividedgame.com/auth/ahd?return=https%3A%2F%2Fops.example";
    expect(safeResultNext(lakeside)).toBe(new URL(lakeside).toString());
  });

  it("drops anything that could leave the site or run script", () => {
    for (const bad of [
      "javascript:alert(1)",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "data:text/html,x",
    ]) {
      expect(safeResultNext(bad)).toBe("/settings");
    }
    expect(safeResultNext(null)).toBe("/settings");
  });
});
