// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BattleOddsBar } from "./BattleOddsBar";

afterEach(cleanup);

describe("BattleOddsBar", () => {
  it("renders both directions with their percentages", () => {
    render(<BattleOddsBar oddsPct={46} enemyOddsPct={52} target="CN" unopposed={false} />);
    expect(screen.getByText(/you attack/i)).toBeTruthy();
    expect(screen.getByText("46%")).toBeTruthy();
    expect(screen.getByText(/they attack/i)).toBeTruthy();
    expect(screen.getByText("52%")).toBeTruthy();
  });

  it("uses the viewer's spectrum color for the offensive row", () => {
    render(
      <BattleOddsBar
        oddsPct={46}
        enemyOddsPct={52}
        target="US"
        unopposed={false}
        ownSpectrum="east"
      />
    );
    expect(screen.getByText("46%").style.color).toBe("#dc2626");
  });

  it("names the target", () => {
    render(<BattleOddsBar oddsPct={46} enemyOddsPct={52} target="CN" unopposed={false} />);
    expect(screen.getAllByText(/CN/).length).toBeGreaterThan(0);
  });

  // An enemy with no force at the front has nothing to attack with.
  it("shows only the offensive row when the front is unopposed", () => {
    render(<BattleOddsBar oddsPct={98} enemyOddsPct={4} target="CN" unopposed />);
    expect(screen.getByText(/you attack/i)).toBeTruthy();
    expect(screen.queryByText(/they attack/i)).toBeNull();
  });

  // The two rows are separate engagements, not a partition of one quantity — the
  // component must never render a "remainder" derived from the other row.
  it("does not derive one row from the other", () => {
    render(<BattleOddsBar oddsPct={40} enemyOddsPct={40} target="CN" unopposed={false} />);
    expect(screen.getAllByText("40%").length).toBe(2);
  });

  it("clamps a bar width to the track without dropping the label", () => {
    render(<BattleOddsBar oddsPct={140} enemyOddsPct={-20} target="CN" unopposed={false} />);
    expect(screen.getByText("140%")).toBeTruthy();
    expect(screen.getByText("-20%")).toBeTruthy();
  });
  // The percentages cross an untyped JSON boundary; a missing one must read as
  // unavailable rather than rendering "undefined%".
  it("renders a dash for a missing percentage", () => {
    render(
      <BattleOddsBar
        oddsPct={46}
        enemyOddsPct={undefined as unknown as number}
        target="CN"
        unopposed={false}
      />
    );
    expect(screen.getByText("46%")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
