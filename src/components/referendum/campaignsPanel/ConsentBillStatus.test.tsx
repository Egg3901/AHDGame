/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsentBillStatus } from "./ConsentBillStatus";
import type { ConsentBillView } from "@/lib/referendum/consentBillView";

const westminster: ConsentBillView = {
  id: "w1",
  title: "Scotland (Independence) Bill",
  countryName: "United Kingdom",
  outcome: "pending",
  votesFor: 0,
  votesAgainst: 0,
  href: "/congress/bills/w1",
};

describe("ConsentBillStatus", () => {
  it("renders nothing when there are no bills", () => {
    const { container } = render(
      <ConsentBillStatus kind="independence" bills={[]} deadlineTurn={null} currentTurn={1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the pending bill, its link, and the window countdown", () => {
    render(
      <ConsentBillStatus
        kind="independence"
        bills={[westminster]}
        deadlineTurn={420}
        currentTurn={408}
      />
    );
    expect(screen.getByText("Scotland (Independence) Bill")).toBeTruthy();
    expect(screen.getByText("Before the house")).toBeTruthy();
    expect(screen.getByText(/in 12 turns/i)).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/congress/bills/w1");
  });

  it("explains both bills must pass for a reunification", () => {
    render(
      <ConsentBillStatus
        kind="reunification"
        bills={[
          westminster,
          {
            ...westminster,
            id: "d1",
            title: "Reunification with NI",
            countryName: "Ireland",
            outcome: "passed",
            href: "/congress/bills/d1",
          },
        ]}
        deadlineTurn={null}
        currentTurn={1}
      />
    );
    expect(screen.getByText(/Both consent bills must pass/i)).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
  });
});
