/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CabinetGuide } from "./CabinetGuide";
import { cabinetGuideContent } from "@/lib/seeds/wiki/content/cabinetGuide";

describe("CabinetGuide widget", () => {
  it("renders every country tab and dash-free seat content", () => {
    const { container } = render(<CabinetGuide />);

    const tabs = screen.getAllByRole("tab");
    const tabLabels = tabs.map((t) => t.textContent);
    expect(tabLabels).toEqual(
      expect.arrayContaining([
        "United States",
        "United Kingdom",
        "Germany",
        "Japan",
        "China",
        "Ireland",
        "Nigeria",
        "Scotland (devolved)",
        "Wales (devolved)",
      ])
    );

    // Walk every tab: each renders seats and no em/en dashes anywhere.
    for (const tab of tabs) {
      fireEvent.click(tab);
      const seats = container.querySelectorAll("section section");
      expect(seats.length).toBeGreaterThan(0);
      expect(container.textContent).not.toMatch(/[–—]/);
    }

    // Spot-check the UK tab renders known mechanics from the constants.
    fireEvent.click(screen.getByRole("tab", { name: "United Kingdom" }));
    expect(container.textContent).toContain("Chancellor of the Exchequer");
    expect(container.textContent).toContain("Westminster Funding Pool");
    expect(container.textContent).toContain("Emergency Powers Declaration");
    expect(container.textContent).toContain("coming soon"); // Foreign Secretary
  });

  it("cabinet-guide markdown intro is dash-free and embeds the widget fence", () => {
    expect(cabinetGuideContent).not.toMatch(/[–—]/);
    expect(cabinetGuideContent).toContain("```cabinet-guide");
  });
});
