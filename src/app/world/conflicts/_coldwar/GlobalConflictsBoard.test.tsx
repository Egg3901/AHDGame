// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GlobalConflictsBoard } from "./GlobalConflictsBoard";
import type { Conflict } from "./conflicts";

const pushSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushSpy(...a) }),
}));

afterEach(cleanup);

const base: Conflict = {
  id: "c1",
  conflictId: 1,
  name: "Manchurian Front",
  type: "interstate",
  region: "East Asia",
  years: "1953 – present",
  x: 70,
  y: 30,
  lean: 70,
  west: "NATO",
  east: "PLA",
  sev: "CRITICAL",
  intensity: 70,
  status: "NATO holds 30% of CN",
  deaths: "12,345 casualties",
  escalating: false,
};

describe("GlobalConflictsBoard", () => {
  it("renders a live conflict's name, sides and severity", () => {
    render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
    expect(screen.getByText("NATO")).toBeTruthy();
    expect(screen.getByText("PLA")).toBeTruthy();
    expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0);
    expect(screen.getByText("NATO holds 30% of CN")).toBeTruthy();
  });

  it("allows the hero stat cards to wrap on narrow screens", () => {
    const { container } = render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    const active = screen.getByText("ACTIVE").parentElement;
    expect(active?.parentElement?.style.flexWrap).toBe("wrap");
    // A sibling card in the same wrapping row — the point of the test is that the row
    // holds several and wraps them. It named READINESS until the placeholder command
    // boards that card linked to were removed.
    expect(container.textContent).toContain("SITUATION");
  });

  it("keeps the at-peace state when there are none", () => {
    render(<GlobalConflictsBoard year={1953} conflicts={[]} />);
    expect(screen.getByText(/no active conflicts/i)).toBeTruthy();
  });

  it("counts the conflicts it was given", () => {
    const { container } = render(
      <GlobalConflictsBoard year={1953} conflicts={[base, { ...base, id: "c2" }]} />
    );
    expect(container.textContent).toContain("2");
  });

  // A war neither superpower backs has no position on a west↔east axis.
  it("omits the lean bar for an unbacked conflict", () => {
    const { container } = render(
      <GlobalConflictsBoard year={1953} conflicts={[{ ...base, lean: null }]} />
    );
    expect(container.querySelector("[data-lean-bar]")).toBeNull();
  });

  it("draws the lean bar for a backed conflict", () => {
    const { container } = render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    expect(container.querySelector("[data-lean-bar]")).toBeTruthy();
  });

  it("omits the map pin for a host with no anchor", () => {
    const { container } = render(
      <GlobalConflictsBoard year={1953} conflicts={[{ ...base, x: null, y: null }]} />
    );
    expect(container.querySelector("[data-pin]")).toBeNull();
    // …but the conflict is still listed.
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
  });

  it("draws the pin for an anchored host", () => {
    const { container } = render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    expect(container.querySelector("[data-pin]")).toBeTruthy();
  });
  // setHover fires from the list cards too, so an unanchored conflict can become
  // the hovered one without ever having had a pin.
  it("does not show the hover label for an unanchored conflict", () => {
    const { container } = render(
      <GlobalConflictsBoard year={1953} conflicts={[{ ...base, x: null, y: null }]} />
    );
    fireEvent.mouseEnter(screen.getByText("Manchurian Front").closest("div")!);
    expect(container.querySelector("[data-hover-label]")).toBeNull();
  });

  it("shows the hover label for an anchored one", () => {
    const { container } = render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    fireEvent.mouseEnter(screen.getByText("Manchurian Front").closest("div")!);
    expect(container.querySelector("[data-hover-label]")).toBeTruthy();
  });
  it("links a card to that conflict's own page", () => {
    pushSpy.mockClear();
    render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    fireEvent.click(screen.getByText("Manchurian Front").closest("div")!);
    expect(pushSpy).toHaveBeenCalledWith("/world/conflicts/1");
  });

  it("does not advertise the browser-local Cold War command console", () => {
    render(<GlobalConflictsBoard year={1953} conflicts={[base]} />);
    expect(screen.queryByText("The Cold War")).toBeNull();
  });
});
