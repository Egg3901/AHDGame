import { describe, expect, it } from "vitest";
import {
  DROPDOWN_PANEL_CLASS,
  MOBILE_MENU_PANEL_CLASS,
  NOTIFICATION_LIST_CLASS,
} from "./dropdownStyles";

describe("dropdownStyles", () => {
  it("uses viewport-aware max-height for dropdown panels", () => {
    expect(DROPDOWN_PANEL_CLASS).toContain("100dvh");
    expect(DROPDOWN_PANEL_CLASS).toContain("overflow-y-auto");
    expect(DROPDOWN_PANEL_CLASS).toContain("safe-area-inset-bottom");
  });

  it("uses viewport-aware max-height for mobile menu panels", () => {
    expect(MOBILE_MENU_PANEL_CLASS).toContain("100dvh");
    expect(MOBILE_MENU_PANEL_CLASS).toContain("overscroll-contain");
  });

  it("uses viewport-aware max-height for notification lists", () => {
    expect(NOTIFICATION_LIST_CLASS).toContain("overflow-y-auto");
    expect(NOTIFICATION_LIST_CLASS).toContain("100dvh");
  });
});
