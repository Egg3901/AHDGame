/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NppSlotTierTable } from "./NppSlotTierTable";

describe("NppSlotTierTable", () => {
  it("renders every tier from the shared source of truth", () => {
    render(<NppSlotTierTable />);
    expect(screen.getByText("under 30%")).toBeTruthy();
    expect(screen.getByText("30% – 39%")).toBeTruthy();
    expect(screen.getByText("40% – 49%")).toBeTruthy();
    expect(screen.getByText("50%+")).toBeTruthy();
    // Top tier is flagged as the cap.
    expect(screen.getByText("(max)")).toBeTruthy();
  });

  it("highlights the tier the current org qualifies for", () => {
    render(<NppSlotTierTable currentOrg={44} />);
    // 44% lands in the 40–49% tier; that row carries the active highlight class.
    const activeLabel = screen.getByText("40% – 49%");
    expect(activeLabel.closest("div")?.className).toContain("bg-primary/10");
    // A non-active tier does not.
    const inactiveLabel = screen.getByText("under 30%");
    expect(inactiveLabel.closest("div")?.className).not.toContain("bg-primary/10");
  });

  it("highlights the default floor tier for over-cap / low org", () => {
    render(<NppSlotTierTable currentOrg={20} />);
    const activeLabel = screen.getByText("under 30%");
    expect(activeLabel.closest("div")?.className).toContain("bg-primary/10");
  });

  it("shows the current org readout when provided and omits it otherwise", () => {
    const { unmount } = render(<NppSlotTierTable currentOrg={44} />);
    expect(screen.getByText("current 44%")).toBeTruthy();
    unmount();
    render(<NppSlotTierTable />);
    expect(screen.queryByText(/current/)).toBeNull();
  });
});
