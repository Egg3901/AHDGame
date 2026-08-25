/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NhsQualityTile, nhsBand } from "./NhsQualityTile";

afterEach(() => cleanup());

describe("nhsBand", () => {
  it("bands by value", () => {
    expect(nhsBand(80).label).toBe("Thriving");
    expect(nhsBand(50).label).toBe("Strained");
    expect(nhsBand(10).label).toBe("Failing");
  });
});

describe("NhsQualityTile", () => {
  it("renders quality, band, meter and the budget share", () => {
    render(<NhsQualityTile quality={72} healthcareShare={30} />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Thriving")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("72");
    expect(screen.getByText(/Healthcare is 30% of the Budget/)).toBeTruthy();
  });

  it("clamps and omits the share when absent", () => {
    render(<NhsQualityTile quality={140} />);
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.queryByText(/of the Budget/)).toBeNull();
  });

  it("shows the failing band at low quality", () => {
    render(<NhsQualityTile quality={9} />);
    expect(screen.getByText("Failing")).toBeTruthy();
  });
});
