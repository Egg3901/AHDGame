/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarningBandBadge } from "./WarningBandBadge";

describe("WarningBandBadge", () => {
  it("maps green/amber/red to semantic labels", () => {
    const { rerender } = render(<WarningBandBadge band="green" />);
    expect(screen.getByText("Stable")).toBeTruthy();

    rerender(<WarningBandBadge band="amber" />);
    expect(screen.getByText("Watch")).toBeTruthy();

    rerender(<WarningBandBadge band="red" confidence={0.12} />);
    expect(screen.getByText(/At risk/)).toBeTruthy();
    expect(screen.getByText(/12%/)).toBeTruthy();
  });

  it("shows Unknown when band is missing", () => {
    render(<WarningBandBadge band={null} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
  });
});
