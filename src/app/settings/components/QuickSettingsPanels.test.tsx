/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SETTINGS_SWITCH_THUMB_OFF,
  SETTINGS_SWITCH_THUMB_ON,
  SettingsSwitch,
} from "./QuickSettingsPanels";

describe("SettingsSwitch (ticket #998)", () => {
  it("anchors the thumb with an explicit left inset so it cannot park outside the track", () => {
    expect(SETTINGS_SWITCH_THUMB_OFF).toContain("left-1");
    expect(SETTINGS_SWITCH_THUMB_ON).toContain("left-1");
    expect(SETTINGS_SWITCH_THUMB_OFF).toContain("translate-x-0");
    // 18px thumb + 4px insets inside a 48px track → 22px of travel, not 25px from an
    // implicit static position (which previously left the knob beside the pill).
    expect(SETTINGS_SWITCH_THUMB_ON).toContain("translate-x-[22px]");
    expect(SETTINGS_SWITCH_THUMB_ON).not.toContain("translate-x-[25px]");
  });

  it("keeps the on/off thumb classes inside the track bounds", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SettingsSwitch checked={false} onChange={onChange} label="Reduced motion" />
    );

    const thumb = screen.getByTestId("settings-switch-thumb");
    expect(thumb.className).toContain("left-1");
    expect(thumb.className).toContain("translate-x-0");
    expect(thumb.className).not.toContain("translate-x-[25px]");

    rerender(<SettingsSwitch checked={true} onChange={onChange} label="Reduced motion" />);
    expect(thumb.className).toContain("left-1");
    expect(thumb.className).toContain("translate-x-[22px]");
    expect(thumb.className).not.toContain("translate-x-[25px]");
  });

  it("toggles via click and exposes switch semantics", () => {
    const onChange = vi.fn();
    render(<SettingsSwitch checked={false} onChange={onChange} label="High contrast" />);

    const control = screen.getByRole("switch", { name: "High contrast" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
