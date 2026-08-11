/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillProposalChip } from "./BillProposalChip";

describe("BillProposalChip", () => {
  it("renders nothing for a non-admin bill", () => {
    const { container } = render(<BillProposalChip adminProposed={false} category="economy" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Admin Proposed' for a normal admin bill", () => {
    render(<BillProposalChip adminProposed category="economy" />);
    expect(screen.getByText("Admin Proposed")).toBeTruthy();
    expect(screen.queryByText("Referendum Passed")).toBeNull();
  });

  it("shows 'Referendum Passed' for a reunification consent bill", () => {
    render(<BillProposalChip adminProposed category="reunification" />);
    expect(screen.getByText("Referendum Passed")).toBeTruthy();
    expect(screen.queryByText("Admin Proposed")).toBeNull();
  });
});
