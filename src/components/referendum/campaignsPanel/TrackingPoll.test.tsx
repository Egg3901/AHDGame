/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackingPoll } from "./TrackingPoll";

describe("TrackingPoll", () => {
  it("shows a placeholder with fewer than two readings", () => {
    render(<TrackingPoll history={[]} />);
    expect(screen.getByText(/poll opens/i)).toBeTruthy();
  });

  it("draws the data path and the 50% threshold line", () => {
    const { container } = render(
      <TrackingPoll
        history={[
          { turn: 1, yesShare: 48 },
          { turn: 2, yesShare: 51 },
          { turn: 3, yesShare: 53 },
        ]}
      />
    );
    expect(container.querySelector('[data-ref="poll-line"]')).toBeTruthy();
    expect(container.querySelector('[data-ref="poll-area"]')).toBeTruthy();
    expect(container.querySelector('[data-ref="threshold"]')).toBeTruthy();
  });
});
