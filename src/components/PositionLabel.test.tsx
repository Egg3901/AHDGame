/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionLabel } from "./PositionLabel";

describe("PositionLabel", () => {
  it("renders the candidate-scale bucket label for a value", () => {
    render(<PositionLabel value={-0.76} axis="economic" />);
    // getByText throws if absent — existence is the assertion.
    expect(screen.getByText("Center-Left")).toBeTruthy();
  });
  it("renders the social bucket label on the social axis", () => {
    render(<PositionLabel value={-0.66} axis="social" />);
    expect(screen.getByText("Center-Liberal")).toBeTruthy();
  });
  it("exposes the exact score via data-score for hover", () => {
    render(<PositionLabel value={-0.76} axis="economic" />);
    expect(screen.getByText("Center-Left").getAttribute("data-score")).toBe("-0.76");
  });
});
