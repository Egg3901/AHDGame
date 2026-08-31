// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NavairCommandClient, type CommandFormation } from "./NavairCommandClient";

afterEach(cleanup);

/**
 * What the command page says about repair.
 *
 * A formation's condition has always been shown as a bare percentage, which tells a
 * commander what is wrong and nothing about what to do. These lines exist to name the
 * rate, the limit and the reason, because "not mending" on its own sends a player to the
 * wiki while "your supply is below what a yard needs" sends them to move the fleet.
 */

const formation = (over: Partial<CommandFormation> = {}): CommandFormation => ({
  id: "f1",
  name: "1st Test Squadron",
  type: "Guided-Missile Destroyer",
  domain: "naval",
  station: "weu",
  stationName: "Western Europe",
  mission: "PORT",
  missionTarget: null,
  integrity: 40,
  readiness: 70,
  supply: 100,
  auto: false,
  warnings: [],
  repair: { mending: true, text: "Mending 12% a turn in port, up to 100%." },
  ...over,
});

const props = {
  countryCode: "uk",
  positionId: "defence_secretary",
  summary: {
    holding: [],
    frontsWithoutAir: [],
    starving: 0,
    atWar: true,
    navalLots: 0,
    airLots: 0,
  },
  navalMissions: [{ key: "PORT", label: "In port", desc: "Resting." }],
  airMissions: [],
  stations: [{ id: "weu", name: "Western Europe", allowed: true }],
};

describe("NavairCommandClient repair", () => {
  it("says what a mending formation is recovering and how far", () => {
    render(<NavairCommandClient {...props} formations={[formation()]} />);
    expect(screen.getByText("Mending 12% a turn in port, up to 100%.")).toBeDefined();
  });

  it("says why a formation is not mending", () => {
    render(
      <NavairCommandClient
        {...props}
        formations={[
          formation({ repair: { mending: false, text: "Not mending: fought this turn." } }),
        ]}
      />
    );
    expect(screen.getByText("Not mending: fought this turn.")).toBeDefined();
  });

  // A commander cannot act on paid repair without knowing whether there is anything in
  // the store to pay with.
  it("names the materiel available for paid repair", () => {
    render(
      <NavairCommandClient
        {...props}
        summary={{ ...props.summary, navalLots: 12, airLots: 3 }}
        formations={[formation()]}
      />
    );
    expect(screen.getByText(/12 naval/)).toBeDefined();
  });

  it("says plainly when there is no materiel for paid repair", () => {
    render(<NavairCommandClient {...props} formations={[formation()]} />);
    expect(screen.getByText(/no naval or air materiel in store/i)).toBeDefined();
  });
});
