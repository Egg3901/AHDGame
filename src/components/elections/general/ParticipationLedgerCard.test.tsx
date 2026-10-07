/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParticipationLedgerCard } from "./ParticipationLedgerCard";

describe("ParticipationLedgerCard", () => {
  it("renders the additive Method 4 explanation in plain language", () => {
    render(
      <ParticipationLedgerCard
        data={{
          calibrationId: "US-v1",
          baseline: 60,
          salience: 2,
          competitiveness: 3,
          access: -1,
          contact: 4,
          saturation: -0.5,
          resolvedTurnout: 67.5,
          economicSalience: 1.1,
          socialSalience: 0.9,
          competitivenessScore: 1,
        }}
      />
    );
    expect(screen.getByText("Why people are voting")).toBeTruthy();
    expect(screen.getByText("Usual turnout")).toBeTruthy();
    expect(screen.getByText("Campaign contact")).toBeTruthy();
    expect(screen.getByText("Repeated contact fatigue")).toBeTruthy();
    expect(screen.getByText("67.5%")).toBeTruthy();
  });

  it("renders nothing for a v1 snapshot", () => {
    const { container } = render(<ParticipationLedgerCard data={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a zero effect neutrally", () => {
    render(
      <ParticipationLedgerCard
        data={{
          calibrationId: "US-v1",
          baseline: 60,
          salience: 0,
          competitiveness: 1,
          access: -1,
          contact: 2,
          saturation: -0.5,
          resolvedTurnout: 61.5,
          economicSalience: 1,
          socialSalience: 1,
          competitivenessScore: 0.5,
        }}
      />
    );
    expect(screen.getByText("0.0 pts").className).toContain("text-muted");
  });
});
