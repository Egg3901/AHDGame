/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartyRegimeBadge } from "./PartyRegimeBadge";

describe("PartyRegimeBadge", () => {
  it("renders 'Ruling' chip for regimeStatus='ruling'", () => {
    render(<PartyRegimeBadge regimeStatus="ruling" />);
    expect(screen.queryByText("Ruling")).not.toBeNull();
  });

  it("renders 'Approved' chip for regimeStatus='approved'", () => {
    render(<PartyRegimeBadge regimeStatus="approved" />);
    expect(screen.queryByText("Approved")).not.toBeNull();
  });

  it("renders 'Banned' chip for regimeStatus='banned'", () => {
    render(<PartyRegimeBadge regimeStatus="banned" />);
    expect(screen.queryByText("Banned")).not.toBeNull();
  });

  it("renders nothing for regimeStatus=null", () => {
    const { container } = render(<PartyRegimeBadge regimeStatus={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for regimeStatus=undefined", () => {
    const { container } = render(<PartyRegimeBadge regimeStatus={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("attaches an accessibility label naming the regime tier", () => {
    render(<PartyRegimeBadge regimeStatus="banned" />);
    const chip = screen.getByLabelText(/Regime status:\s*Banned/);
    expect(chip).not.toBeNull();
  });
});
