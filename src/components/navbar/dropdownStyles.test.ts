import { describe, expect, it } from "vitest";
import {
  DROPDOWN_PANEL_CLASS,
  MENU_DIVIDER_CLASS,
  MENU_ICON_CLASS,
  MENU_ROW_ACTIVE_CLASS,
  MENU_ROW_BASE_CLASS,
  MENU_ROW_IDLE_CLASS,
  MENU_SECTION_LABEL_CLASS,
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

  it("shares one section label, divider, icon, and row language across menus", () => {
    expect(MENU_SECTION_LABEL_CLASS).toContain("uppercase");
    expect(MENU_SECTION_LABEL_CLASS).toContain("tracking-wider");
    expect(MENU_DIVIDER_CLASS).toContain("border-t");
    expect(MENU_ICON_CLASS).toContain("h-4 w-4");
    expect(MENU_ROW_BASE_CLASS).toContain("rounded-lg");
    expect(MENU_ROW_BASE_CLASS).toContain("gap-2.5");
    expect(MENU_ROW_IDLE_CLASS).toContain("hover:bg-background/60");
    expect(MENU_ROW_ACTIVE_CLASS).toContain("bg-primary/10");
  });
});
