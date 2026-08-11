/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnchoredDropdownPanel } from "./AnchoredDropdownPanel";

/**
 * Mirrors how the experimental navbar wires a dropdown: the anchor `ref` is
 * attached to the *trigger* element (the parent of the portaled panel) and only
 * while the menu is open. React commits a parent's ref after its children's
 * layout effects run, so the panel must tolerate `anchorRef.current` being null
 * on the first open pass — otherwise it never positions and stays invisible.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div className="relative" ref={open ? anchorRef : undefined}>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
      {open && (
        <AnchoredDropdownPanel anchorRef={anchorRef} align="left">
          <span>Menu Item</span>
        </AnchoredDropdownPanel>
      )}
    </div>
  );
}

describe("AnchoredDropdownPanel", () => {
  it("renders the portaled menu after the anchor ref attaches (open on click)", async () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByText("toggle"));

    // With the anchor-timing fix the menu positions on the next frame; findBy*
    // polls until it appears. (Pre-fix this stayed null forever and timed out.)
    const menu = await screen.findByRole("menu");
    expect(menu.getAttribute("data-nav-dropdown")).toBe("true");
    expect(screen.getByText("Menu Item")).toBeTruthy();
  });

  it("removes the menu when closed", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("toggle"));
    await screen.findByRole("menu");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
