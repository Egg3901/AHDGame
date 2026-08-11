// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { LedgerPole } from "@/lib/alignment/queries/worldAlignment";
import { ShareBar } from "./ShareBar";

const TWO: LedgerPole[] = [
  { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
  { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
];
const THREE: LedgerPole[] = [
  { id: "WASHINGTON", label: "Washington", shortLabel: "WSH", accentToken: "info" },
  { id: "MOSCOW", label: "Moscow", shortLabel: "MOS", accentToken: "error" },
  { id: "BEIJING", label: "Beijing", shortLabel: "BEI", accentToken: "warning" },
];

describe("ShareBar", () => {
  it("renders one segment per non-zero share, widths as percentages", () => {
    const { container } = render(
      <ShareBar poles={TWO} shares={{ WEST: 22, EAST: 50 }} nonAligned={28} />
    );
    const segments = Array.from(container.querySelectorAll("span"));
    // Two blocs plus the remainder, which is non-alignment rather than blank.
    expect(segments).toHaveLength(3);
    expect(segments[0].style.width).toBe("22%");
    expect(segments[1].style.width).toBe("50%");
    expect(segments[2].style.width).toBe("28%");
  });

  it("omits a pole sitting at zero, but never the remainder", () => {
    const { container } = render(
      <ShareBar poles={TWO} shares={{ WEST: 40, EAST: 0 }} nonAligned={60} />
    );
    const segments = Array.from(container.querySelectorAll("span"));
    expect(segments).toHaveLength(2); // West + non-aligned; East is dropped
    expect(segments[1].className).toBe("bg-success");
  });

  it("fills the bar for a nation neither bloc has persuaded", () => {
    // Wholly non-aligned is a full bar, not an empty one: the remainder IS a
    // stance, not an absence of one.
    const { container } = render(<ShareBar poles={TWO} shares={{}} nonAligned={100} />);
    const segments = Array.from(container.querySelectorAll("span"));
    expect(segments).toHaveLength(1);
    expect(segments[0].className).toBe("bg-success");
    expect(segments[0].style.width).toBe("100%");
  });

  it("uses the static token classes, never an interpolated one", () => {
    const { container } = render(
      <ShareBar poles={THREE} shares={{ WASHINGTON: 40, MOSCOW: 16, BEIJING: 8 }} nonAligned={18} />
    );
    const classes = Array.from(container.querySelectorAll("span")).map((s) => s.className);
    // Three blocs, then the remainder — which is non-alignment, drawn in the
    // fourth token rather than left as blank track.
    expect(classes).toEqual(["bg-info", "bg-error", "bg-warning", "bg-success"]);
  });

  it("describes the whole distribution for assistive tech", () => {
    const { container } = render(
      <ShareBar poles={TWO} shares={{ WEST: 22, EAST: 50 }} nonAligned={28} />
    );
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe(
      // Two decimals here too: a screen-reader user is entitled to the same
      // precision the sighted label carries, and at 0.04 a turn that is where
      // the movement lives.
      "West 22.00, East 50.00, non-aligned 28.00"
    );
  });

  it("uses no hardcoded colour anywhere", () => {
    const { container } = render(
      <ShareBar poles={THREE} shares={{ WASHINGTON: 40 }} nonAligned={42} />
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
