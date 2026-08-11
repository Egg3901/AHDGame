/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MomentumIndicator } from "./MomentumIndicator";

describe("MomentumIndicator", () => {
  it("renders a neutral dash when momentum is null", () => {
    render(<MomentumIndicator momentum={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows an up arrow, signed recent delta, and the since-open total", () => {
    render(
      <MomentumIndicator
        momentum={{ direction: "up", recentDelta: 2.1, totalDelta: 6, latest: 56 }}
      />
    );
    expect(screen.getByText(/▲/)).toBeTruthy();
    expect(screen.getByText(/\+2\.1/)).toBeTruthy();
    expect(screen.getByText(/\+6\.0 since open/)).toBeTruthy();
  });

  it("shows a down arrow and a negative delta", () => {
    render(
      <MomentumIndicator
        momentum={{ direction: "down", recentDelta: -1.4, totalDelta: -3.2, latest: 47 }}
      />
    );
    expect(screen.getByText(/▼/)).toBeTruthy();
    expect(screen.getByText(/-1\.4/)).toBeTruthy();
  });
});
