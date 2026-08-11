// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TheaterWarRoom } from "./TheaterWarRoom";
import { natMods } from "@/lib/military/doctrineTree";
import type { CombatState } from "../useCombatState";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      oddsPct: 64,
      counterOddsPct: 52,
      ownStrength: 1234,
      supply: { level: 88, state: { l: "SUPPLIED", c: "#86d978" } },
      enemyBand: "Weaker force",
      unopposed: false,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state = {
  screen: "warroom",
  selectedUnitId: null,
  units: [
    {
      _id: "u1",
      countryId: "US",
      branchId: "army",
      domain: "ground",
      name: "1st Armored",
      type: "Armored Division",
      icon: "tank",
      basePower: 92,
      personnel: 15000,
      upkeepBase: 180,
      posture: "standard",
      techTier: 2,
      vet: 1,
      xp: 0,
      readiness: 70,
      equipment: { firepower: 1, protection: 1, support: 1 },
      drill: null,
      theaterId: "afghan",
      assignedGeneralId: null,
      createdTurn: 1,
    },
  ],
  conflictAssignments: [],
  // No shard urls: the front map renders its meter without fetching geometry.
  conflicts: [
    {
      id: "afghan",
      name: "Central Asian Front",
      hostCountry: "CN",
      control: 75,
      sideALabel: "NATO",
      sideBLabel: "PLA",
      enemyCountries: ["CN"],
      occupier: "A",
      occupierCountry: "US",
      hostRegionCodes: [],
    },
  ],
  generalsById: {},
  positions: {},
  pendingDeclarations: [],
  reports: [],
  turn: 40,
  country: "US",
  countryCode: "us",
  positionId: "secretary_of_defense",
} as unknown as CombatState;

/** The forecast URL for a given target, once one has been requested. */
function urlFor(target: string): string | undefined {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .find((u) => u.includes(`targetCountry=${target}`));
}

// Regression: the picker listed a global 9-country table filtered by bloc, so an East
// German player was offered its own Warsaw Pact allies (plus a "USSR" entry that is not
// a country) and never the NATO belligerents it was actually at war with. Targets are a
// property of the selected front now, so they come from the conflict's opposing roster.
describe("TheaterWarRoom target picker", () => {
  function stateWithEnemies(enemyCountries: string[] | undefined) {
    return {
      ...state,
      conflicts: [{ ...state.conflicts[0], enemyCountries }],
    } as unknown as CombatState;
  }

  it("offers exactly the selected front's opposing roster", () => {
    render(
      <TheaterWarRoom
        state={stateWithEnemies(["US", "UK"])}
        natMods={natMods({})}
        dispatch={vi.fn()}
      />
    );
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .sort();
    expect(options).toEqual(["UK", "US"]);
  });

  it("offers nothing when the viewer is not a belligerent at this front", () => {
    render(
      <TheaterWarRoom
        state={stateWithEnemies(undefined)}
        natMods={natMods({})}
        dispatch={vi.fn()}
      />
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  // An empty picker under "Select a target nation" asks for something impossible.
  it("says so instead of rendering an empty picker when there is nobody to attack", () => {
    render(
      <TheaterWarRoom state={stateWithEnemies([])} natMods={natMods({})} dispatch={vi.fn()} />
    );
    expect(screen.getByText(/no opposing nation to declare against at this front/i)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /target nation/i })).toBeNull();
    expect(screen.queryByText(/select a target nation/i)).toBeNull();
  });

  it("declares against a target from that roster, not from a bloc table", () => {
    const dispatch = vi.fn();
    render(
      <TheaterWarRoom
        state={stateWithEnemies(["US", "UK"])}
        natMods={natMods({})}
        dispatch={dispatch}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: /target nation/i }), {
      target: { value: "UK" },
    });
    fireEvent.click(screen.getByRole("button", { name: /declare offensive/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "DECLARE",
      theaterId: "afghan",
      targetCountry: "UK",
    });
  });
});

describe("TheaterWarRoom", () => {
  it("fetches the forecast for the selected target and renders odds + enemy band", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /target nation/i }), {
      target: { value: "CN" },
    });
    await waitFor(() => expect(urlFor("CN")).toBeTruthy());
    const url = urlFor("CN")!;
    expect(url).toContain("/api/country/us/executive/cabinet/secretary_of_defense/battle/forecast");
    expect(url).toContain("theaterId=afghan");
    await waitFor(() => expect(screen.getByText("64%")).toBeTruthy());
    expect(screen.getByText("Weaker force")).toBeTruthy();
  });

  it("shows an unavailable state when the projection fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/projection unavailable/i)).toBeTruthy());
  });

  it("surfaces an undefended front", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        oddsPct: 98,
        counterOddsPct: 4,
        ownStrength: 1234,
        supply: { level: 88, state: { l: "SUPPLIED", c: "#86d978" } },
        enemyBand: "No forces detected",
        unopposed: true,
      }),
    });
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no enemy forces at this front/i)).toBeTruthy());
  });

  it("reports when a side broke off", async () => {
    const withReport = {
      ...state,
      reports: [
        {
          id: "r1",
          theaterId: "afghan",
          theaterName: "afghan",
          turn: 40,
          noContact: false,
          role: "offensive" as const,
          win: false,
          ownLoss: 300,
          enemyLoss: 900,
          enemyCountry: "CN",
          verdict: "Costly Defeat",
          retreat: "own" as const,
        },
      ],
    } as unknown as CombatState;
    render(<TheaterWarRoom state={withReport} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/withdrew/)).toBeTruthy());
  });
});

describe("TheaterWarRoom territory", () => {
  it("titles the war room with the conflict's real name, not its id", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/CENTRAL ASIAN FRONT/)).toBeTruthy());
  });

  it("surfaces who holds how much of the host", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/NATO occupies 25% of CN/)).toBeTruthy());
  });
});

describe("TheaterWarRoom battle odds", () => {
  it("shows both directions of the engagement", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/you attack/i)).toBeTruthy());
    expect(screen.getByText(/they attack/i)).toBeTruthy();
    expect(screen.getByText("52%")).toBeTruthy();
  });

  it("drops the offensive row's counterpart when the front is unopposed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        oddsPct: 98,
        counterOddsPct: 4,
        ownStrength: 1234,
        supply: { level: 88, state: { l: "SUPPLIED", c: "#86d978" } },
        enemyBand: "No forces detected",
        unopposed: true,
      }),
    });
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/you attack/i)).toBeTruthy());
    expect(screen.queryByText(/they attack/i)).toBeNull();
  });
});

describe("TheaterWarRoom coalition rules", () => {
  it("states both halves of the coalition rule beside the order", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    expect(await screen.findByText(/allies who declare against this front/i)).toBeTruthy();
    expect(screen.getByText(/defend automatically/i)).toBeTruthy();
    // The cost of posting units is the non-obvious half; it must be said here too.
    expect(screen.getByText(/commits them to its battles/i)).toBeTruthy();
  });

  it("says when the odds already count allied contingents", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        oddsPct: 71,
        counterOddsPct: 40,
        ownStrength: 2000,
        supply: { level: 80, state: { l: "SUPPLIED", c: "#86d978" } },
        enemyBand: "Weaker force",
        unopposed: false,
        alliedContingents: 3,
      }),
    });
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    expect(await screen.findByText(/3 allied contingents/i)).toBeTruthy();
  });

  it("stays quiet about contingents when fighting alone", async () => {
    render(<TheaterWarRoom state={state} natMods={natMods({})} dispatch={vi.fn()} />);
    await screen.findByText("64%");
    expect(screen.queryByText(/allied contingents/i)).toBeNull();
  });
});
