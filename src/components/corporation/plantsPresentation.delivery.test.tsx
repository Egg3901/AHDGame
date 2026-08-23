// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryLimitedPill } from "./plantsPresentation";
import type { FreightClass } from "@/lib/logistics/freightClass";

function renderTooltip(freightClass: FreightClass | null): string {
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
    expect(tooltip).toContain("nearer buyers");
    expect(tooltip).not.toContain("Improve the interstate route");
  });

  it("does not send grid-limited players to a price lever that cannot reach the grid", () => {
    // The sourcing pass asks at the STATE MARKET price; a sector's pricing
    // posture only ever reaches the clearing book. Telling a grid seller to cut
    // its price points at a mechanism no player lever touches.
    const tooltip = renderTooltip("grid");

    expect(tooltip).not.toContain("lower this sector's price");
    expect(tooltip).toContain("pricing posture cannot offset");
  });

  it("never advises building freight when the route class is unknown", () => {
    // What Napoleon Hill saw in #1169: eighteen ENERGY sectors rendered the
    // null-class fallback, which told them to add freight capacity. Energy
    // moves on the grid and consumes no freight at all.
    const tooltip = renderTooltip(null);

    expect(tooltip).toContain("Siting capacity nearer buyers helps whatever the route");
    expect(tooltip).toContain("moves on the grid");
    expect(tooltip).not.toMatch(/^.*Add freight capacity out of this state/);
  });

  it("hides itself entirely below the reporting threshold", () => {
    const { container } = render(<DeliveryLimitedPill fraction={0} freightClass="bulk" />);

    expect(container.querySelector("[title]")).toBeNull();
  });
});
