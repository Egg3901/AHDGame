/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TugOfWar } from "./TugOfWar";

describe("TugOfWar", () => {
  it("renders Yes/No shares and a clamped fill", () => {
    const { container } = render(<TugOfWar yesShare={57} showThreshold />);
    expect(screen.getByText(/57/)).toBeTruthy();
    expect(screen.getByText(/43/)).toBeTruthy();
    const fill = container.querySelector('[data-ref="yes-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("57%");
  });
  it("clamps out-of-range shares", () => {
    const { container } = render(<TugOfWar yesShare={140} />);
    const fill = container.querySelector('[data-ref="yes-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});
