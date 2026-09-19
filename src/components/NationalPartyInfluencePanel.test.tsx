/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NationalPartyInfluencePanel } from "./NationalPartyInfluencePanel";

const fakeStats = {
  favorability: 50,
  politicalInfluence: 50,
  loyalty: 50,
  ambition: 50,
  stubbornness: 50,
};

const influenceFixture = {
  partyId: "9",
  partyName: "Reform",
  politicalStrength: 100,
  treasury: 23_931_420,
  actions: [],
  availableStates: ["AK"],
  stateNames: { AK: "Alaska" },
  targetStates: [],
  nppsByState: {
    AK: [
      { id: "n1", name: "Alpha", party: "reform", estimatedChance: 50, stats: fakeStats },
      { id: "n2", name: "Bravo", party: "reform", estimatedChance: 50, stats: fakeStats },
      { id: "n3", name: "Charlie", party: "reform", estimatedChance: 50, stats: fakeStats },
      { id: "n4", name: "Delta", party: "reform", estimatedChance: 50, stats: fakeStats },
    ],
  },
  context: {
    activeElections: [
      {
        id: "e1",
        label: "AK senate (Class 2)",
        state: "AK",
        type: "senate",
        senateClass: 2,
      },
      { id: "e2", label: "AK house", state: "AK", type: "house" },
    ],
    nppCandidacies: [
      { electionId: "e1", candidateId: "c1", nppId: "n1" },
      { electionId: "e2", candidateId: "c2", nppId: "n2" },
      { electionId: "e2", candidateId: "c3", nppId: "n3" },
    ],
    candidates: [],
  },
};

beforeEach(() => {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(influenceFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NationalPartyInfluencePanel cascade", () => {
  it("hides the Race dropdown until a state is selected", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());
    expect(screen.queryByText(/Select Race/i)).toBeNull();
    expect(screen.queryByText(/Select NPP to Influence/i)).toBeNull();
  });

  it("shows race buckets after a state is picked, with house collapsed and Not Running last", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());

    const stateSelect = screen.getByLabelText("Advanced: select state");
    fireEvent.change(stateSelect, { target: { value: "AK" } });

    await waitFor(() => expect(screen.getByText(/Select Race/i)).toBeTruthy());
    const raceSelect = screen.getByLabelText("Advanced: select race") as HTMLSelectElement;
    const raceLabels = Array.from(raceSelect.options).map((o) => o.text);

    expect(raceLabels.slice(1)).toEqual([
      "House (2 NPPs)",
      "Senate (Class 2) (1 NPP)",
      "Not Running (1 NPP)",
    ]);
  });

  it("filters the NPP dropdown to the selected race", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select state"), { target: { value: "AK" } });

    await waitFor(() => expect(screen.getByText(/Select Race/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select race"), {
      target: { value: "house" },
    });

    await waitFor(() => expect(screen.getByText(/Select NPP to Influence/i)).toBeTruthy());
    const nppSelect = screen.getByLabelText("Advanced: select NPP") as HTMLSelectElement;
    const nppLabels = Array.from(nppSelect.options)
      .map((o) => o.text)
      .filter((label) => !label.startsWith("--"));
    expect(nppLabels).toEqual(["Bravo (reform)", "Charlie (reform)"]);
  });

  it("surfaces NPPs without an active in-state candidacy under Not Running", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select state"), { target: { value: "AK" } });

    await waitFor(() => expect(screen.getByText(/Select Race/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select race"), {
      target: { value: "__not_running" },
    });

    await waitFor(() => expect(screen.getByText(/Select NPP to Influence/i)).toBeTruthy());
    const nppSelect = screen.getByLabelText("Advanced: select NPP") as HTMLSelectElement;
    const nppLabels = Array.from(nppSelect.options)
      .map((o) => o.text)
      .filter((label) => !label.startsWith("--"));
    expect(nppLabels).toEqual(["Delta (reform)"]);
  });

  it("clears NPP (but not state) when the race changes", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select state"), { target: { value: "AK" } });

    await waitFor(() => expect(screen.getByText(/Select Race/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select race"), {
      target: { value: "house" },
    });

    await waitFor(() => expect(screen.getByText(/Select NPP to Influence/i)).toBeTruthy());
    const nppSelectBefore = screen.getByLabelText("Advanced: select NPP") as HTMLSelectElement;
    fireEvent.change(nppSelectBefore, { target: { value: "n2" } });
    expect(nppSelectBefore.value).toBe("n2");

    fireEvent.change(screen.getByLabelText("Advanced: select race"), {
      target: { value: "senate:2" },
    });

    await waitFor(() => {
      const nppSelectAfter = screen.getByLabelText("Advanced: select NPP") as HTMLSelectElement;
      expect(nppSelectAfter.value).toBe("");
    });
    // State dropdown still on AK
    expect((screen.getByLabelText("Advanced: select state") as HTMLSelectElement).value).toBe("AK");
  });

  it("clears Race and NPP when the state changes", async () => {
    render(<NationalPartyInfluencePanel partyId="9" partyColor="#ff0000" country="us" />);

    await waitFor(() => expect(screen.getByText(/Select State/i)).toBeTruthy());
    const stateSelect = screen.getByLabelText("Advanced: select state") as HTMLSelectElement;

    fireEvent.change(stateSelect, { target: { value: "AK" } });
    await waitFor(() => expect(screen.getByText(/Select Race/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Advanced: select race"), {
      target: { value: "house" },
    });
    await waitFor(() => expect(screen.getByText(/Select NPP to Influence/i)).toBeTruthy());

    fireEvent.change(stateSelect, { target: { value: "" } });

    expect(screen.queryByText(/Select Race/i)).toBeNull();
    expect(screen.queryByText(/Select NPP to Influence/i)).toBeNull();
  });
});
