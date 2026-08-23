// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DossierBenchView } from "@/lib/settlement/queries/dossier";
import { DelegationBench } from "./DelegationBench";

function benchRow(over: Partial<DossierBenchView> = {}): DossierBenchView {
  return {
    seatId: "US",
    name: "United States · NSC",
    tier: "SECONDARY",
    multiplier: "1.0×",
    bloc: "west",
    committedPoints: 0,
    barPct: 0,
    actedThisTurn: false,
    isViewer: false,
    offices: [
      { role: "headOfGovernment", title: "President", holder: "Ariane Yeong" },
      { role: "foreignMinister", title: "Secretary of State", holder: null },
    ],
    ...over,
  };
}

describe("DelegationBench", () => {
  it("names the office and its holder inside the delegation block", () => {
    render(<DelegationBench title="NATO DELEGATIONS" bloc="west" seats={[benchRow()]} />);
    const block = screen.getByRole("region", { name: /NATO DELEGATIONS/i });
    expect(within(block).getByText("President")).toBeTruthy();
    expect(within(block).getByText("Ariane Yeong")).toBeTruthy();
  });

  it("names an unheld office as vacant rather than dropping the row", () => {
    render(<DelegationBench title="NATO DELEGATIONS" bloc="west" seats={[benchRow()]} />);
    // The Secretary of State line stays: which offices carry the seat is the
    // point, and "vacant" says no one can act through this one.
    expect(screen.getByText("Secretary of State")).toBeTruthy();
    expect(screen.getByText("vacant")).toBeTruthy();
  });

  it("keeps each seat's offices inside that seat's own row", () => {
    render(
      <DelegationBench
        title="WARSAW PACT DELEGATIONS"
        bloc="east"
        seats={[
          benchRow({
            seatId: "DD",
            name: "GDR · Staatsrat",
            offices: [
              { role: "headOfGovernment", title: "General Secretary", holder: "Takashi Ito" },
              { role: "foreignMinister", title: "Minister of Foreign Affairs", holder: null },
            ],
          }),
          benchRow({
            seatId: "RU",
            name: "USSR · Politburo",
            offices: [
              { role: "headOfGovernment", title: "Premier", holder: null },
              {
                role: "foreignMinister",
                title: "Minister of Foreign Affairs",
                holder: "Ilya Sarkin",
              },
            ],
          }),
        ]}
      />
    );
    const gdr = screen.getByTestId("delegation-seat-DD");
    const ussr = screen.getByTestId("delegation-seat-RU");
    expect(within(gdr).getByText("Takashi Ito")).toBeTruthy();
    expect(within(gdr).queryByText("Ilya Sarkin")).toBeNull();
    expect(within(ussr).getByText("Ilya Sarkin")).toBeTruthy();
    expect(within(ussr).getByText("Premier")).toBeTruthy();
  });

  it("renders both offices of a delegation nobody holds", () => {
    render(
      <DelegationBench
        title="NATO DELEGATIONS"
        bloc="west"
        seats={[
          benchRow({
            seatId: "UK",
            name: "United Kingdom · FCO",
            offices: [
              { role: "headOfGovernment", title: "Prime Minister", holder: null },
              { role: "foreignMinister", title: "Foreign Secretary", holder: null },
            ],
          }),
        ]}
      />
    );
    const uk = screen.getByTestId("delegation-seat-UK");
    expect(within(uk).getByText("Prime Minister")).toBeTruthy();
    expect(within(uk).getByText("Foreign Secretary")).toBeTruthy();
    expect(within(uk).getAllByText("vacant")).toHaveLength(2);
  });
});
