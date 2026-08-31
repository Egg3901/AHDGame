/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RedistrictingGuide } from "./RedistrictingGuide";

describe("RedistrictingGuide", () => {
  it("gives blocked players the full route to a partisan redraw", () => {
    render(<RedistrictingGuide />);

    expect(screen.getByText("State Redistricting Authority Act")).toBeTruthy();
    expect(screen.getByText("Legislature-drawn")).toBeTruthy();
    expect(screen.getByText(/state trifecta/i)).toBeTruthy();
    expect(screen.getByText(/census year/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /full redistricting guide/i }).getAttribute("href")
    ).toBe("/wiki/us-house-redistricting");
  });
});
