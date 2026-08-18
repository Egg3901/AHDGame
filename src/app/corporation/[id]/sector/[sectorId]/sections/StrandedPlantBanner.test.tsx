// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STRANDED_WARN_TURNS } from "@/lib/corporations/strandedPlant";
import StrandedPlantBanner from "./StrandedPlantBanner";

describe("StrandedPlantBanner", () => {
  it("stays hidden until the warning threshold", () => {
    const { container } = render(
      <StrandedPlantBanner lowFillTurns={STRANDED_WARN_TURNS - 1} soldFraction={0.4} isCeo />
    );

    expect(container.textContent).toBe("");
  });

  it("reports current sales without claiming inventory was destroyed", () => {
    render(
      <StrandedPlantBanner lowFillTurns={STRANDED_WARN_TURNS} soldFraction={0.37} isCeo={false} />
    );

    const warning = screen.getByRole("status", { name: "Stranded plant warning" });
    expect(warning.textContent).toContain(`For ${STRANDED_WARN_TURNS} turns`);
    expect(warning.textContent).toContain("last turn: 37%");
    expect(warning.textContent).toContain("earns no revenue this turn");
    expect(warning.textContent).not.toContain("money spent making it is lost");
    expect(warning.textContent).not.toContain("Options:");
  });

  it("shows the CEO every relevant response", () => {
    render(<StrandedPlantBanner lowFillTurns={STRANDED_WARN_TURNS} soldFraction={0.2} isCeo />);

    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("stockpile storable goods");
    expect(warning.textContent).toContain("set growth to zero");
    expect(warning.textContent).toContain("mothball");
    expect(warning.textContent).toContain("list it for sale");
    expect(warning.textContent).toContain("abandon it");
  });
});
