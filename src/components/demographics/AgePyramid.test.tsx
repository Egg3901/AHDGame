/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgePyramid } from "./AgePyramid";

const ages = { male: Array(101).fill(8), female: Array(101).fill(10) };

describe("AgePyramid", () => {
  it("renders a band label and the male/female legend", () => {
    render(<AgePyramid ages={ages} />);
    expect(screen.getByText("0–4")).toBeTruthy();
    // exact strings — /Male/i would also match "Female"
    expect(screen.getByText("Male")).toBeTruthy();
    expect(screen.getByText("Female")).toBeTruthy();
  });

  it("shows an empty state when there is no population", () => {
    render(<AgePyramid ages={{ male: Array(101).fill(0), female: Array(101).fill(0) }} />);
    expect(screen.getByText(/no population data/i)).toBeTruthy();
  });

  it("renders a fallback when ages is null", () => {
    render(<AgePyramid ages={null} />);
    expect(screen.getByText(/no population data/i)).toBeTruthy();
  });
});
