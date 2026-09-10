/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrimaryTileBoard } from "./PrimaryTileBoard";
import type { PrimaryTileVM } from "./primaryBlendViewModel";

const TILES: PrimaryTileVM[] = [
  {
    stateId: "IA",
    name: "Iowa",
    leaderId: "c1",
    leaderName: "First Filer",
    background: "#2563eb",
    ink: "#ffffff",
    voted: true,
    title: "Iowa: First Filer won",
  },
  {
    stateId: "OH",
    name: "Ohio",
    leaderId: "c1",
    leaderName: "First Filer",
    background: "#1c2a3a",
    ink: "#ffffff",
    voted: false,
    title: "Ohio: First Filer projected to win",
  },
];

function renderBoard(over: Partial<Parameters<typeof PrimaryTileBoard>[0]> = {}) {
  const props = {
    tiles: TILES,
    selectedStateId: null,
    onSelect: vi.fn(),
    columns: 11,
    ...over,
  };
  return { ...render(<PrimaryTileBoard {...props} />), props };
}

describe("PrimaryTileBoard", () => {
  it("puts one tile on the board per state, labelled by its code", () => {
    renderBoard();
    expect(screen.getByText("IA")).toBeTruthy();
    expect(screen.getByText("OH")).toBeTruthy();
  });

  it("calls back with the state that was chosen", () => {
    const { props } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /Iowa/ }));
    expect(props.onSelect).toHaveBeenCalledWith("IA");
  });

  it("marks the chosen tile for assistive tech, not only with an outline", () => {
    renderBoard({ selectedStateId: "IA" });
    expect(screen.getByRole("button", { name: /Iowa/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Ohio/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("names the leader on every tile, so colour is never the only signal", () => {
    renderBoard();
    expect(screen.getByRole("button", { name: "Iowa: First Filer won" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ohio: First Filer projected to win" })).toBeTruthy();
  });

  it("marks selection without taking the focus ring away from keyboard users", () => {
    // Selection is drawn with an inset shadow; `outline` stays free for the
    // browser's focus ring, which an outline-based marker would have replaced
    // on every unselected tile.
    renderBoard({ selectedStateId: "IA" });
    const selected = screen.getByRole("button", { name: /Iowa/ }) as HTMLElement;
    const unselected = screen.getByRole("button", { name: /Ohio/ }) as HTMLElement;
    expect(selected.style.boxShadow).toContain("inset");
    expect(selected.style.outline).toBe("");
    expect(unselected.style.outline).toBe("");
  });

  it("makes every tile reachable from the keyboard", () => {
    renderBoard();
    // Buttons, not divs: a div grid would strand keyboard users on a control
    // that drives the carve-up below it.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders nothing at all when there are no tiles", () => {
    const { container } = renderBoard({ tiles: [] });
    expect(container.firstChild).toBeNull();
  });
});
