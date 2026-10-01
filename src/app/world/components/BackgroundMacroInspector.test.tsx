/** @vitest-environment happy-dom */
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getWorldEntityMapSnapshot, backgroundMacroFeatureIds } from "@/lib/world/worldEntityMap";
import BackgroundMacroInspector from "./BackgroundMacroInspector";

afterEach(cleanup);
function fixture() {
  const snapshot = getWorldEntityMapSnapshot("1991-default");
  snapshot.byFeatureId["124"].macroSummary = {
    population: 350000,
    economicSystem: "market",
    stability: 0.4,
    tradeExposure: 0.18,
    lastMacroTickTurn: null,
    contributionComputedOnTurn: 1,
    provenance: "estimated-background",
  };
  return snapshot;
}
it("only active seeded background entities can be inspected", () => {
  const snapshot = fixture();
  const summary = snapshot.byFeatureId["124"].macroSummary;
  snapshot.byFeatureId["840"].macroSummary = summary;
  snapshot.byFeatureId["test_dissolved"] = { ...snapshot.byFeatureId["124"], status: "dissolved" };
  expect([...backgroundMacroFeatureIds(snapshot)]).toEqual(["124"]);
});

describe("background macro inspection", () => {
  it("offers a country picker, macro summary and estimate provenance without political controls", () => {
    const snapshot = fixture();
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <BackgroundMacroInspector
          snapshot={snapshot}
          selectedEntityId={selected}
          onSelect={setSelected}
        />
      );
    }
    render(<Harness />);
    const picker = screen.getByRole("combobox", { name: "Inspect a background country" });
    fireEvent.change(picker, { target: { value: "CA" } });
    const panel = screen.getByRole("complementary", { name: "Canada macro summary" });
    expect(panel.textContent).toContain("Background macro simulation");
    expect(panel.textContent).toContain("350,000");
    expect(panel.textContent).toContain("Political play is unavailable");
    expect(panel.textContent).toContain("not historical statistics");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close macro summary" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("does not offer a background picker when no aggregate data is seeded", () => {
    render(
      <BackgroundMacroInspector
        snapshot={getWorldEntityMapSnapshot("1991-default")}
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
