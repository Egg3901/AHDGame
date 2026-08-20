/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BuildQueueBadge, buildQueueBadgeLabel } from "./plantsPresentation";

afterEach(cleanup);

// Ticket #1141: a player saw "+6.9k 38T" beside a FREIGHT pill and asked what
// freight meant in sectors. The pill is the build queue, not freight, and its
// only explanation was a hover title.
const QUEUE = {
  orders: 1,
  unitsOrdered: 6900,
  unitsRemaining: 6900,
  nextOnlineTurn: 288,
  turnsRemaining: 38,
};

describe("BuildQueueBadge", () => {
  it("says what it is on its face, not only on hover", () => {
    render(<BuildQueueBadge queue={QUEUE} />);
    expect(screen.getByText("building")).toBeTruthy();
  });

  it("still shows the amount and the turns to the next order", () => {
    render(<BuildQueueBadge queue={QUEUE} />);
    expect(screen.getByText(/6\.9k/)).toBeTruthy();
    expect(screen.getByText(/38T/)).toBeTruthy();
  });

  it("gives a screen reader the same sentence as the tooltip", () => {
    const label = buildQueueBadgeLabel(QUEUE);
    render(<BuildQueueBadge queue={QUEUE} />);
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(label).toContain("under construction");
    expect(label).toContain("38 turns");
  });

  it("renders nothing when no capacity is on order", () => {
    const { container } = render(
      <BuildQueueBadge
        queue={{
          orders: 0,
          unitsOrdered: 0,
          unitsRemaining: 0,
          nextOnlineTurn: null,
          turnsRemaining: null,
        }}
      />
    );
    expect(container.textContent).toBe("");
  });
});
