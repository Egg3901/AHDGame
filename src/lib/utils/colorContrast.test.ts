import { contrastTextColor } from "./colorContrast";

describe("contrastTextColor", () => {
  // 3-digit shorthand — the regression this fix covers
  test("#fff returns dark text (#0f172a)", () => {
    expect(contrastTextColor("#fff")).toBe("#0f172a");
  });

  test("#000 returns white text (#ffffff)", () => {
    expect(contrastTextColor("#000")).toBe("#ffffff");
  });

  test("#abc expands to #aabbcc and returns dark text", () => {
    expect(contrastTextColor("#abc")).toBe("#0f172a");
  });

  // 6-digit — existing behaviour preserved
  test("#ffffff returns white text", () => {
    expect(contrastTextColor("#ffffff")).toBe("#ffffff");
  });

  test("#0f172a returns dark text", () => {
    expect(contrastTextColor("#0f172a")).toBe("#0f172a");
  });

  test("invalid input falls back to white", () => {
    expect(contrastTextColor("#ffff")).toBe("#ffffff");
    expect(contrastTextColor("#ggg")).toBe("#ffffff");
    expect(contrastTextColor("not-a-color")).toBe("#ffffff");
  });
});
