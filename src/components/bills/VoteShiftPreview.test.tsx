/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VoteShiftPreview } from "./VoteShiftPreview";

afterEach(cleanup);

/** Text of the line that starts with the given label ("Aye:" / "Nay:"). */
function line(label: string): string {
  return screen.getByText(label).parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("VoteShiftPreview", () => {
  it("renders nothing for a spectator", () => {
    const { container } = render(<VoteShiftPreview preview={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the Aye line and the Nay line with direction and amount per axis", () => {
    render(
      <VoteShiftPreview
        preview={{
          current: { economic: 1, social: 0 },
          aye: { economic: -0.25, social: 0.25 },
          nay: { economic: 0.25, social: 0 },
        }}
      />
    );
    expect(line("Aye:")).toBe("Aye: Economic 0.25 toward Left, Social 0.25 toward Traditional");
    expect(line("Nay:")).toBe("Nay: Economic 0.25 toward Right, Social no change");
  });

  it("says so plainly when a vote would not move the voter at all", () => {
    render(
      <VoteShiftPreview
        preview={{
          current: { economic: 2, social: 0 },
          aye: { economic: 0, social: 0 },
          nay: { economic: -0.25, social: 0 },
        }}
      />
    );
    expect(line("Aye:")).toBe("Aye: no change");
    expect(line("Nay:")).toBe("Nay: Economic 0.25 toward Left, Social no change");
  });

  it("collapses to one line when neither vote would move the voter", () => {
    // A bill with no ideology (a war declaration, a tariff-only bill) or a legacy
    // vote that predates the ledger: claiming a position match would be false.
    const { container } = render(
      <VoteShiftPreview
        preview={{
          current: { economic: 2, social: 0 },
          aye: { economic: 0, social: 0 },
          nay: { economic: 0, social: 0 },
        }}
      />
    );
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "This vote does not move your positions."
    );
  });

  it("labels the vote already cast as such instead of claiming a position match", () => {
    render(
      <VoteShiftPreview
        currentVote="for"
        preview={{
          current: { economic: 1.25, social: 0 },
          aye: { economic: 0, social: 0 },
          nay: { economic: -0.5, social: 0 },
        }}
      />
    );
    expect(line("Aye:")).toBe("Aye: your current vote, no further change");
    expect(line("Nay:")).toBe("Nay: Economic 0.50 toward Left, Social no change");
  });

  it("shows a half-point swing when switching a vote already cast", () => {
    render(
      <VoteShiftPreview
        preview={{
          current: { economic: 1.25, social: 0 },
          aye: { economic: 0, social: 0 },
          nay: { economic: -0.5, social: 0 },
        }}
      />
    );
    expect(line("Nay:")).toBe("Nay: Economic 0.50 toward Left, Social no change");
  });
});
