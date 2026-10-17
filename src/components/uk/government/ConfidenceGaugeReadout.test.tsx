/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConfidenceGaugeReadout, confidenceBand } from "./ConfidenceGaugeReadout";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      title: "Government confidence",
      description: "Government confidence description",
      "bands.secure": "Secure",
      "bands.shaky": "Shaky",
      "bands.crisis": "Crisis",
      "bands.collapsed": "Collapsed",
      "history.title": "Confidence history",
      "history.points": "Recorded changes",
      "history.notEnoughData": "Not enough history",
      "history.retention": "History retention",
      "history.value": "Confidence",
    })[key] ?? key,
}));

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
    render(<ConfidenceGaugeReadout value={72} history={[]} />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Secure")).toBeTruthy();
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("72");
  });

  it("clamps out-of-range values", () => {
    render(<ConfidenceGaugeReadout value={140} history={[]} />);
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows the crisis band at low confidence", () => {
    render(<ConfidenceGaugeReadout value={8} history={[]} />);
    expect(screen.getByText("Crisis")).toBeTruthy();
  });
});
