/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConfidenceGaugeReadout, confidenceBand } from "./ConfidenceGaugeReadout";

afterEach(() => cleanup());

describe("confidenceBand", () => {
  it("bands by value", () => {
    expect(confidenceBand(90).label).toBe("Secure");
    expect(confidenceBand(50).label).toBe("Shaky");
    expect(confidenceBand(10).label).toBe("Crisis");
    expect(confidenceBand(0).label).toBe("Collapsed");
  });
});

describe("ConfidenceGaugeReadout", () => {
  it("renders the value, band and an accessible meter", () => {
    render(<ConfidenceGaugeReadout value={72} />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Secure")).toBeTruthy();
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("72");
  });

  it("clamps out-of-range values", () => {
    render(<ConfidenceGaugeReadout value={140} />);
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows the crisis band at low confidence", () => {
    render(<ConfidenceGaugeReadout value={8} />);
    expect(screen.getByText("Crisis")).toBeTruthy();
  });
});
