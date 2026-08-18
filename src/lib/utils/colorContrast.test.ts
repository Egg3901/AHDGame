import { describe, expect, it } from "vitest";

import { contrastTextColor } from "./colorContrast";

describe("contrastTextColor", () => {
  it("expands 3-digit shorthand", () => {
    expect(contrastTextColor("#fff")).toBe("#0f172a");
    expect(contrastTextColor("#000")).toBe("#ffffff");
    expect(contrastTextColor("#abc")).toBe("#0f172a");
  });

  it("keeps 6-digit behaviour", () => {
    expect(contrastTextColor("#ffffff")).toBe("#0f172a");
    expect(contrastTextColor("#0f172a")).toBe("#ffffff");
  });

  it("falls back to white on malformed input", () => {
    expect(contrastTextColor("#ffff")).toBe("#ffffff");
    expect(contrastTextColor("#ggg")).toBe("#ffffff");
    expect(contrastTextColor("not-a-color")).toBe("#ffffff");
  });
});
