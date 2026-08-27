// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TensionHeader } from "./TensionHeader";

afterEach(cleanup);

const events = [
  { turn: 12, label: "United States conducts a Fission Device test", delta: 9 },
  { turn: 10, label: "Geneva accords hold", delta: -4 },
];

const powers = [
  {
    countryId: "US",
    flag: "🇺🇸",
    name: "United States",
    warheads: 24,
    bestDevice: "Fission Device",
  },
];

function setup(over: Partial<React.ComponentProps<typeof TensionHeader>> = {}) {
  return render(
    <TensionHeader
      tension={42.5}
      band="ELEVATED"
      defcon={4}
      events={events}
      powers={powers}
      pressures={{
        baseline: 12,
        escalation: 4,
        activeCrises: 6,
        arsenal: 5.9,
        wars: 0,
        floor: 27.9,
        escalationLevel: 1,
        activeCrisisCount: 2,
        totalWarheads: 24,
        activeWarCount: 0,
        nuclearWarCount: 0,
      }}
      dials={{ source: "tension", procurementMultiplier: 1.15, detenteGoodwillPenalty: 6 }}
      {...over}
    />
  );
}

describe("TensionHeader", () => {
  it("shows the tension reading with its band and DEFCON", () => {
    setup();
    expect(screen.getByText("43")).toBeTruthy();
    expect(screen.getAllByText("ELEVATED").length).toBeGreaterThan(0);
    expect(screen.getByText("DEFCON 4")).toBeTruthy();
  });

  it("marks the tension value on a labeled five-band scale", () => {
    const { container } = setup();
    const marker = container.querySelector("[data-tension-marker]") as HTMLElement;
    expect(marker?.style.left).toBe("42.5%");
    expect(screen.getByText("DETENTE")).toBeTruthy();
    expect(screen.getByText("BRINK")).toBeTruthy();
  });

  it("explains the standing pressure and current strategic effects", () => {
    setup();
    expect(screen.getByText("WHAT HOLDS THE FLOOR AT 27.9")).toBeTruthy();
    expect(screen.getByText("rung 1")).toBeTruthy();
    expect(screen.getByText("2 open")).toBeTruthy();
    expect(screen.getAllByText("24 warheads").length).toBeGreaterThan(0);
    expect(screen.getByText("x1.15")).toBeTruthy();
    expect(screen.getByText("-6")).toBeTruthy();
  });

  it("lists recent developments with turn and signed delta, spikes and relief apart", () => {
    setup();
    expect(screen.getByText(/Fission Device test/)).toBeTruthy();
    expect(screen.getByText("T12")).toBeTruthy();
    expect(screen.getByText("+9")).toBeTruthy();
    expect(screen.getByText("-4")).toBeTruthy();
  });

  it("caps the feed at six developments", () => {
    setup({
      events: Array.from({ length: 10 }, (_, i) => ({
        turn: i + 1,
        label: `Development ${i + 1}`,
        delta: 1,
      })),
    });
    expect(screen.getAllByText(/^Development /).length).toBe(6);
  });

  it("says the wire is quiet with nothing on the ledger", () => {
    setup({ events: [] });
    expect(screen.getByText(/pressure floor shown above/i)).toBeTruthy();
  });

  it("names each nuclear power with its stockpile and best device tier", () => {
    setup();
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getAllByText("24 warheads").length).toBe(2);
    expect(screen.getByText("FISSION DEVICE")).toBeTruthy();
  });

  it("marks a pre-test programme rather than inventing a tier", () => {
    setup({ powers: [{ ...powers[0], bestDevice: null }] });
    expect(screen.getByText("PRE-TEST")).toBeTruthy();
  });

  it("renders no powers strip when nobody holds the bomb", () => {
    setup({ powers: [] });
    expect(screen.queryByText("PRE-TEST")).toBeNull();
    expect(screen.queryByText("United States")).toBeNull();
    expect(screen.getByText(/No declared nuclear programme/i)).toBeTruthy();
  });
});
