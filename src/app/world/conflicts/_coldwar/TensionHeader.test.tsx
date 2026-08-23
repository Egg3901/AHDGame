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
      {...over}
    />
  );
}

describe("TensionHeader", () => {
  it("shows the tension reading with its band and DEFCON", () => {
    setup();
    expect(screen.getByText("43")).toBeTruthy();
    expect(screen.getByText("ELEVATED")).toBeTruthy();
    expect(screen.getByText("DEFCON 4")).toBeTruthy();
  });

  it("draws the gauge at the tension value", () => {
    const { container } = setup();
    const gauge = container.querySelector("[data-tension-gauge]") as HTMLElement;
    expect(gauge?.style.width).toBe("42.5%");
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
    expect(screen.getByText(/wire is quiet/i)).toBeTruthy();
  });

  it("names each nuclear power with its stockpile and best device tier", () => {
    setup();
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("24")).toBeTruthy();
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
  });
});
