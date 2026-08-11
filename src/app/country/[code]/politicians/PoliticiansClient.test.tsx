/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import PoliticiansClient from "./PoliticiansClient";
import type { PoliticianData } from "@/lib/politicians/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us" }),
}));

function politician(partial: Partial<PoliticianData> & { id: string }): PoliticianData {
  return {
    name: `Pol ${partial.id}`,
    party: "1",
    partyName: "Democratic Party",
    partyColor: "#3b82f6",
    countryId: "US",
    homeState: "PA",
    homeStateName: "Pennsylvania",
    currentOffice: "Senator",
    officeType: "senate",
    politicalInfluence: 50,
    nationalInfluence: 50,
    favorability: 55,
    funds: 1000,
    isNPP: false,
    ...partial,
  } as PoliticianData;
}

const ROSTER: PoliticianData[] = [
  politician({
    id: "a",
    name: "Abigail Whitmore",
    nationalInfluence: 94.2,
    currentOffice: "President",
    officeType: "president",
  }),
  politician({ id: "b", name: "Jonas Calloway", nationalInfluence: 47.1 }),
  politician({ id: "n", name: "Robo Delegate", nationalInfluence: 30, isNPP: true, funds: null }),
];

function renderList() {
  return render(
    <PoliticiansClient initialPoliticians={ROSTER} initialStats={{ playerCount: 2, nppCount: 1 }} />
  );
}

describe("PoliticiansClient ranked list", () => {
  it("renders the column-header ladder with PLAYER badges and the office column", () => {
    renderList();
    expect(screen.getByText("Influence")).toBeTruthy(); // column headers present
    expect(screen.getByText("President")).toBeTruthy(); // office column content
    expect(screen.getAllByText("PLAYER")).toHaveLength(2);
    expect(screen.getByText("94.2")).toBeTruthy();
  });

  it("hides NPPs by default and shows them when Players only is toggled off", () => {
    renderList();
    expect(screen.queryByText("Robo Delegate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Players only/ }));
    expect(screen.getByText("Robo Delegate")).toBeTruthy();
  });

  it("scales every influence bar to the current leader", () => {
    const { container } = renderList();
    const bars = [...container.querySelectorAll("span[style]")]
      .map((el) => (el as HTMLElement).style.width)
      .filter(Boolean);
    expect(bars[0]).toBe("100%");
    expect(parseFloat(bars[1])).toBeCloseTo(50, 0);
  });

  it("swaps the favorability column for funds when sorting by funds", () => {
    renderList();
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "funds" } });
    expect(screen.getByText("Funds")).toBeTruthy();
    expect(screen.queryByText("Favorability")).toBeNull();
  });

  it("filters by party via the dropdown", () => {
    render(
      <PoliticiansClient
        initialPoliticians={[
          ...ROSTER,
          politician({ id: "r", name: "Rival Person", party: "2", partyName: "Republican Party" }),
        ]}
        initialStats={{ playerCount: 3, nppCount: 1 }}
      />
    );
    fireEvent.change(screen.getByLabelText("Party"), { target: { value: "2" } });
    expect(screen.getByText("Rival Person")).toBeTruthy();
    expect(screen.queryByText("Abigail Whitmore")).toBeNull();
  });
});
