/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PersuasionDrivers, type PersuasionDriverCandidate } from "./PersuasionDrivers";
import enElections from "../../../../messages/en/elections.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

function cand(
  over: Partial<PersuasionDriverCandidate> & { id: string; party: string; name: string }
): PersuasionDriverCandidate {
  return {
    characterId: `ch-${over.id}`,
    partyColor: "#888",
    partyEcon: 0,
    partySocial: 0,
    economicPosition: 0,
    socialPosition: 0,
    favorability: 50,
    politicalInfluence: 60,
    nationalInfluence: 60,
    isNPP: false,
    sharePct: 50,
    ...over,
  };
}

const THREE_WAY: PersuasionDriverCandidate[] = [
  cand({
    id: "d1",
    party: "dem",
    name: "Alice Dem",
    sharePct: 55,
    economicPosition: 0,
    socialPosition: 0,
  }),
  cand({
    id: "r1",
    party: "rep",
    name: "Bob Rep",
    sharePct: 30,
    economicPosition: 3,
    socialPosition: 3,
  }),
  cand({
    id: "g1",
    party: "grn",
    name: "Cara Green",
    sharePct: 15,
    economicPosition: -2,
    socialPosition: -1,
  }),
];

describe("PersuasionDrivers", () => {
  it("renders two selectors defaulting to leader (focus) and top cross-party rival (opponent)", () => {
    render(
      <PersuasionDrivers stateId="CA" stateName="California" candidates={THREE_WAY} inputs={{}} />
    );
    const focus = screen.getByLabelText("Focus") as HTMLSelectElement;
    const opponent = screen.getByLabelText("Opponent") as HTMLSelectElement;
    expect(focus.value).toBe("d1");
    expect(opponent.value).toBe("r1");
  });

  it("excludes the focus candidate from the opponent options", () => {
    render(
      <PersuasionDrivers stateId="CA" stateName="California" candidates={THREE_WAY} inputs={{}} />
    );
    const opponent = screen.getByLabelText("Opponent") as HTMLSelectElement;
    const values = Array.from(opponent.options).map((o) => o.value);
    expect(values).not.toContain("d1");
    expect(values).toEqual(expect.arrayContaining(["r1", "g1"]));
  });

  it("shows the placeholder when there is no cross-party pair", () => {
    const onePartyField = [
      cand({ id: "d1", party: "dem", name: "Alice Dem", sharePct: 55 }),
      cand({ id: "d2", party: "dem", name: "Dana Dem", sharePct: 45 }),
    ];
    render(
      <PersuasionDrivers
        stateId="CA"
        stateName="California"
        candidates={onePartyField}
        inputs={{}}
      />
    );
    expect(screen.getByText(/No persuasion drivers computed/i)).toBeTruthy();
  });

  it("renders the driver bars (not the placeholder) for a valid pair whose drivers are all zero", () => {
    // Two cross-party candidates equidistant from center, fogged support, no
    // inputs → every driver computes to exactly 0 (the live Dem-vs-Reform CA
    // case). The card must still show the computed bars, not the misleading
    // "data not loaded" placeholder.
    const evenlyMatched = [
      cand({
        id: "d1",
        party: "dem",
        name: "Even Dem",
        sharePct: 55,
        economicPosition: 1,
        socialPosition: 1,
      }),
      cand({
        id: "r1",
        party: "rep",
        name: "Even Rep",
        sharePct: 45,
        economicPosition: -1,
        socialPosition: -1,
      }),
    ];
    render(
      <PersuasionDrivers
        stateId="CA"
        stateName="California"
        candidates={evenlyMatched}
        inputs={{}}
      />
    );
    expect(screen.getByText("Policy alignment")).toBeTruthy();
    expect(screen.getByText("Candidate Support")).toBeTruthy();
    expect(screen.queryByText(/No persuasion drivers computed/i)).toBeNull();
  });

  it("recomputes the bars when the focus selection changes", () => {
    render(
      <PersuasionDrivers stateId="CA" stateName="California" candidates={THREE_WAY} inputs={{}} />
    );
    const focus = screen.getByLabelText("Focus") as HTMLSelectElement;
    expect(focus.value).toBe("d1");
    fireEvent.change(focus, { target: { value: "g1" } });
    // Focus switched; opponent r1 is still cross-party so the pair is valid
    // and the driver rows re-render for the new focus.
    expect(focus.value).toBe("g1");
    expect(screen.getByText("Policy alignment")).toBeTruthy();
  });

  it("renders a % unit for a driver row whose source value is a percentage tilt", () => {
    // A governor's-party candidate (focus) with a gubernatorial coattail input
    // should render a "%"-suffixed Gubernatorial Coattails row, not " pts".
    const cands = [
      cand({
        id: "r1",
        party: "rep",
        name: "Rep Gov-ally",
        sharePct: 50,
        economicPosition: 1,
        socialPosition: 1,
      }),
      cand({
        id: "d1",
        party: "dem",
        name: "Dem",
        sharePct: 50,
        economicPosition: -1,
        socialPosition: -1,
      }),
    ];
    render(
      <PersuasionDrivers
        stateId="CA"
        stateName="California"
        candidates={cands}
        inputs={{ gubernatorialCoattailPctByParty: { rep: 4.5 } }}
      />
    );
    expect(screen.getByText("Gubernatorial Coattails")).toBeTruthy();
    expect(screen.getByText(/\+?4\.5%/)).toBeTruthy();
  });
});
