// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HistoricalConflictsSection } from "./HistoricalConflictsSection";
import type { HistoricalConflictRow } from "./historyView";

afterEach(cleanup);

const base: HistoricalConflictRow = {
  id: "c1",
  conflictId: 7,
  name: "Manchurian Front",
  type: "interstate",
  region: "East Asia",
  years: "1953 to 1955",
  sideA: "NATO",
  sideB: "PLA",
  outcome: { label: "PLA victory", side: "B" },
  deaths: "12,345 casualties",
  archive: { open: false, opensTurn: 577, opensYear: 1965 },
};

describe("HistoricalConflictsSection", () => {
  it("renders a concluded war's identity, sides, outcome and casualties", () => {
    render(<HistoricalConflictsSection rows={[base]} />);
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
    expect(screen.getByText("interstate")).toBeTruthy();
    expect(screen.getByText(/East Asia · 1953 to 1955/)).toBeTruthy();
    expect(screen.getByText("NATO")).toBeTruthy();
    expect(screen.getByText("PLA")).toBeTruthy();
    expect(screen.getByText("PLA victory")).toBeTruthy();
    expect(screen.getByText("12,345 casualties")).toBeTruthy();
  });

  it("says which turn and year the fog lifts while the window runs", () => {
    render(<HistoricalConflictsSection rows={[base]} />);
    expect(screen.getByText("FOG LIFTS T577 · 1965")).toBeTruthy();
  });

  // Distinct from the link's own "OPEN RECORD", which sits on every card.
  it("marks an opened record without repeating the link label", () => {
    render(<HistoricalConflictsSection rows={[{ ...base, archive: { open: true } }]} />);
    expect(screen.getByText("FULL RECORD OPEN")).toBeTruthy();
    expect(screen.queryByText(/FOG LIFTS/)).toBeNull();
  });

  it("links every card to its record by public number", () => {
    render(<HistoricalConflictsSection rows={[base, { ...base, id: "c2", conflictId: 9 }]} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/world/conflicts/7", "/world/conflicts/9"]);
  });

  it("shows an empty state when no war has concluded", () => {
    render(<HistoricalConflictsSection rows={[]} />);
    expect(screen.getByText("No war has yet concluded.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
