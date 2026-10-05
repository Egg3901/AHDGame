/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PoliticalMetricsGate } from "./PoliticalMetricsGate";

const flags = vi.hoisted(() => ({
  loaded: true,
  failed: false,
  resetSystemVersions: { metrics: "v2", legislation: "v2", cabinet: "v2" },
  resetV2Countries: ["US", "UK", "JP"],
}));

vi.mock("@/hooks/useWorldFlags", () => ({ useWorldFlags: () => flags }));
vi.mock("../metrics/ResetMetricsPage", () => ({
  ResetMetricsPage: ({ country }: { country: string }) => <p>v2 metrics for {country}</p>,
}));
vi.mock("./PoliticalMetricsClient", () => ({
  default: ({ code }: { code: string }) => <p>legacy metrics for {code}</p>,
}));

afterEach(cleanup);

describe("PoliticalMetricsGate", () => {
  it("renders the v2 catalog at the established political metrics route", () => {
    render(<PoliticalMetricsGate code="us" />);
    expect(screen.getByText("v2 metrics for US")).toBeTruthy();
    expect(screen.queryByText(/legacy metrics/)).toBeNull();
  });

  it("keeps the legacy catalog when the world selects v1", () => {
    const previous = flags.resetSystemVersions.metrics;
    flags.resetSystemVersions.metrics = "v1";
    try {
      render(<PoliticalMetricsGate code="us" />);
      expect(screen.getByText("legacy metrics for us")).toBeTruthy();
    } finally {
      flags.resetSystemVersions.metrics = previous;
    }
  });

  it("does not substitute legacy data when a v2 country is unverified", () => {
    const previous = flags.resetV2Countries;
    flags.resetV2Countries = ["UK", "JP"];
    try {
      render(<PoliticalMetricsGate code="us" />);
      expect(screen.getByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("Legacy metrics were not loaded")
      );
      expect(screen.queryByText(/legacy metrics/)).toBeNull();
    } finally {
      flags.resetV2Countries = previous;
    }
  });
});
