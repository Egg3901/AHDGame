/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeclarePositionControl } from "./DeclarePositionControl";

describe("DeclarePositionControl", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ positions: [] }) });
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers For and Against, and Withdraw only when a side is set", () => {
    const { rerender } = render(
      <DeclarePositionControl countryId="UK" referendumId="r1" currentSide={null} />
    );
    expect(screen.getByRole("button", { name: /For/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Against/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Withdraw/i })).toBeNull();
    rerender(<DeclarePositionControl countryId="UK" referendumId="r1" currentSide="yes" />);
    expect(screen.getByRole("button", { name: /Withdraw/i })).toBeTruthy();
  });

  it("POSTs a declare to the position route", () => {
    render(<DeclarePositionControl countryId="UK" referendumId="r1" currentSide={null} />);
    fireEvent.click(screen.getByRole("button", { name: /For/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/country/uk/referendum/r1/position",
      expect.objectContaining({ method: "POST" })
    );
  });
});
