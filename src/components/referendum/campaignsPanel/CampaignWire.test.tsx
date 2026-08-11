/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignWire } from "./CampaignWire";

const events = [
  {
    turn: 142,
    kind: "ground",
    side: "yes" as const,
    delta: 0.5,
    summary: "SF canvassed Catholics.",
  },
  { turn: 140, kind: "opened", summary: "The campaign began." },
];

describe("CampaignWire", () => {
  it("renders a coloured swing pill keyed to labels, a kind chip otherwise", () => {
    render(
      <CampaignWire
        events={events}
        page={1}
        totalPages={1}
        pageHref={(p) => `?wire=${p}`}
        labels={{ yes: "Reunify", no: "Stay in UK" }}
      />
    );
    expect(screen.getByText(/\+0\.5 Reunify/)).toBeTruthy();
    expect(screen.getByText(/opened/i)).toBeTruthy();
  });

  it("renders enabled Prev/Next in the middle of the range", () => {
    render(<CampaignWire events={events} page={2} totalPages={3} pageHref={(p) => `?wire=${p}`} />);
    expect(screen.getByRole("link", { name: /Prev/i }).getAttribute("href")).toBe("?wire=1");
    expect(screen.getByRole("link", { name: /Next/i }).getAttribute("href")).toBe("?wire=3");
  });

  it("shows the empty state with no events", () => {
    render(<CampaignWire events={[]} page={1} totalPages={1} pageHref={(p) => `?wire=${p}`} />);
    expect(screen.getByText(/No campaign activity yet/i)).toBeTruthy();
  });
});
