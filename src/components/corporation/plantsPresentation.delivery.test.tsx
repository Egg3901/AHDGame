// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryLimitedPill } from "./plantsPresentation";

function renderTooltip(freightClass: "bulk" | "grid"): string {
  const { container } = render(<DeliveryLimitedPill fraction={0.96} freightClass={freightClass} />);

  return container.querySelector("[title]")?.getAttribute("title") ?? "";
}

describe("DeliveryLimitedPill guidance (ticket #1169)", () => {
  it("turns freight capacity into a concrete player action", () => {
    const tooltip = renderTooltip("bulk");

    expect(tooltip).toContain("Open or buy into a Logistics sector in this state");
    expect(tooltip).toContain("site production nearer buyers");
  });

  it("does not tell grid-limited players to improve an unexplained route", () => {
    const tooltip = renderTooltip("grid");

    expect(tooltip).toContain("Freight capacity will not help grid delivery");
    expect(tooltip).toContain("lower this sector's price");
    expect(tooltip).toContain("site production nearer buyers");
    expect(tooltip).not.toContain("Improve the interstate route");
  });
});
