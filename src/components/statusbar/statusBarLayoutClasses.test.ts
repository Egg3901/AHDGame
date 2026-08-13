import { describe, expect, it } from "vitest";
import {
  MODAL_OVERLAY_Z_INDEX_CLASS,
  STATUS_BAR_CONTAINER_CLASS,
  STATUS_BAR_Z_INDEX_CLASS,
  statusBarRowClassName,
} from "./statusBarLayoutClasses";

const tailwindZ = (className: string) => Number(className.replace("z-", ""));

describe("STATUS_BAR_CONTAINER_CLASS", () => {
  it("stacks below modal overlays so a fixed bar cannot cover a modal's action row", () => {
    // ticket-1061: at equal z-index the later DOM node wins, and the root layout
    // renders StatusBar after {children}. A tie put the bar over modal buttons on
    // phones, where the form is tall enough to reach the bottom of the viewport.
    expect(tailwindZ(STATUS_BAR_Z_INDEX_CLASS)).toBeLessThan(
      tailwindZ(MODAL_OVERLAY_Z_INDEX_CLASS)
    );
    expect(STATUS_BAR_CONTAINER_CLASS).toContain(STATUS_BAR_Z_INDEX_CLASS);
    expect(STATUS_BAR_CONTAINER_CLASS).not.toContain(MODAL_OVERLAY_Z_INDEX_CLASS);
  });

  it("keeps the bar pinned to the bottom edge with safe-area padding", () => {
    expect(STATUS_BAR_CONTAINER_CLASS).toContain("fixed bottom-0 left-0 right-0");
    expect(STATUS_BAR_CONTAINER_CLASS).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});

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
