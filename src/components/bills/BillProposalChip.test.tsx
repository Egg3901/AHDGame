/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillProposalChip } from "./BillProposalChip";

describe("BillProposalChip", () => {
  it("renders nothing for a non-admin bill", () => {
    const { container } = render(<BillProposalChip adminProposed={false} category="economy" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Admin proposed' for a normal admin bill", () => {
    render(<BillProposalChip adminProposed category="economy" />);
    expect(screen.getByText("Admin proposed")).toBeTruthy();
    expect(screen.queryByText("Referendum passed")).toBeNull();
  });

  it("shows 'Referendum passed' for a reunification consent bill", () => {
    render(<BillProposalChip adminProposed category="reunification" />);
    expect(screen.getByText("Referendum passed")).toBeTruthy();
    expect(screen.queryByText("Admin proposed")).toBeNull();
  });
});
