// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PostedGeneralsPanel, type PostedGeneralRow } from "./PostedGeneralsPanel";

afterEach(cleanup);

const rows: PostedGeneralRow[] = [
  {
    id: "g1",
    name: "Gen. Alpha",
    rank: "General",
    divisions: 3,
    inCharge: true,
    isViewer: false,
  },
  { id: "g2", name: "Gen. Bravo", rank: "Colonel", divisions: 1, inCharge: false, isViewer: true },
];

describe("PostedGeneralsPanel", () => {
  it("names every general standing at the front", () => {
    render(<PostedGeneralsPanel generals={rows} />);
    expect(screen.getByText("Gen. Alpha")).toBeTruthy();
    expect(screen.getByText(/Gen\. Bravo/)).toBeTruthy();
  });

  it("marks the Theater Commander, who alone declares here", () => {
    const { container } = render(<PostedGeneralsPanel generals={rows} />);
    expect(screen.getByText(/THEATER COMMANDER/)).toBeTruthy();
    expect(container.textContent).toMatch(/Gen\. Alpha holds this theater/);
  });

  it("marks the viewer's own line", () => {
    const { container } = render(<PostedGeneralsPanel generals={rows} />);
    expect(container.textContent).toMatch(/· YOU/);
  });

  it("states each general's divisions, which travel with them", () => {
    const { container } = render(<PostedGeneralsPanel generals={rows} />);
    expect(container.textContent).toMatch(/General · 3 divisions/);
    // Singular, not "1 divisions". textContent runs straight into the next node,
    // so a word boundary would not fire here — the lookahead is what proves it.
    expect(container.textContent).toMatch(/Colonel · 1 division(?!s)/);
  });

  it("says the front is unheld when no Theater Commander is designated", () => {
    const { container } = render(
      <PostedGeneralsPanel generals={[{ ...rows[1], inCharge: false }]} />
    );
    expect(container.textContent).toMatch(/no theater commander is designated/i);
  });

  it("explains an empty front rather than rendering a bare zero", () => {
    const { container } = render(<PostedGeneralsPanel generals={[]} />);
    expect(container.textContent).toMatch(/none of your nation/i);
  });

  // The command-chain panel's "Who is posted here" link scrolls to this id; if it
  // moves, that link silently stops working again.
  it("carries the anchor the command-chain link points at", () => {
    const { container } = render(<PostedGeneralsPanel generals={rows} />);
    expect(container.querySelector("#posted-here")).toBeTruthy();
  });
});
