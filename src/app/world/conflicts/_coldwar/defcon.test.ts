import { describe, it, expect } from "vitest";
import { defconColor } from "./defcon";

describe("defconColor", () => {
  it("is critical red at DEFCON <= 2", () => {
    expect(defconColor(1)).toBe("#ff5a3c");
    expect(defconColor(2)).toBe("#ff5a3c");
  });
  it("is safe green at DEFCON >= 5", () => {
    expect(defconColor(5)).toBe("#86d978");
  });
  it("is elevated amber otherwise", () => {
    expect(defconColor(3)).toBe("#ff7849");
    expect(defconColor(4)).toBe("#ff7849");
  });
});
