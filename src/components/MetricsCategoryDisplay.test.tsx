// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricsCategoryDisplay } from "./MetricsCategoryDisplay";

vi.mock("./MetricCard", () => ({ MetricCard: () => <div>Metric</div> }));
vi.mock("@/components/metrics/RegionalMetricCard", () => ({
  RegionalMetricCard: () => <div>Regional metric</div>,
}));

describe("regional metric categories", () => {
  it("shows the empty state when a legacy region has no education category", () => {
    render(
      <MetricsCategoryDisplay categoryId="education" categoryName="Education" metrics={undefined} />
    );
    expect(screen.getByText("No metrics available for this category.")).toBeTruthy();
  });

  it("preserves the cards for available metrics, including a zero value", () => {
    render(
      <MetricsCategoryDisplay
        categoryId="education"
        categoryName="Education"
        metrics={{ highSchoolGradRate: { value: 0 } }}
      />
    );
    expect(screen.getByText("1 metrics")).toBeTruthy();
    expect(screen.getByText("Metric")).toBeTruthy();
  });
});
