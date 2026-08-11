import { describe, expect, it } from "vitest";
import { statusBarRowClassName } from "./statusBarLayoutClasses";

describe("statusBarRowClassName", () => {
  it("keeps a horizontal gap for elections/corp/standard so left online count cannot sit flush on Profile", () => {
    for (const layout of ["standard", "corp", "elections"] as const) {
      const classes = statusBarRowClassName(layout);
      expect(classes).toContain("gap-x-3");
      expect(classes).toContain("sm:gap-x-4");
      expect(classes).toContain("justify-between");
      // Wrapping rows need vertical breathing room (command-1953 packs wider).
      expect(classes).toContain("gap-y-2");
      expect(classes).not.toContain("sm:gap-y-0");
    }
  });

  it("keeps full layout centered with its wider chip gap", () => {
    expect(statusBarRowClassName("full")).toContain("gap-x-6");
    expect(statusBarRowClassName("full")).toContain("justify-center");
  });

  it("keeps minimal centered without the between-cluster gap contract", () => {
    const classes = statusBarRowClassName("minimal");
    expect(classes).toContain("justify-center");
    expect(classes).not.toContain("justify-between");
  });
});
