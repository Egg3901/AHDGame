/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders only the inert baseline with fewer than two points", () => {
    const { container } = render(<Sparkline history={[{ turn: 1, yesShare: 50 }]} />);
    expect(container.querySelector('[data-ref="spark-line"]')).toBeNull();
    expect(container.querySelector("line")).toBeTruthy();
  });

  it("draws the data polyline when there are two or more points", () => {
    const { container } = render(
      <Sparkline
        history={[
          { turn: 1, yesShare: 40 },
          { turn: 2, yesShare: 60 },
        ]}
      />
    );
    const path = container.querySelector('[data-ref="spark-line"]');
    expect(path).toBeTruthy();
    expect(path!.getAttribute("d")).toContain("M 0");
  });
});
