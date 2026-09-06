/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FactorLedgerCard, type FactorLedgerCandidate } from "./FactorLedgerCard";
import { FACTOR_ORDER, type FactorLedgerSnapshot } from "@/lib/electionEngine/factorLedger";
import enElections from "../../../../messages/en/elections.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const CANDIDATES: FactorLedgerCandidate[] = [
  { id: "c1", name: "Ada Vance", color: "#3b82f6" },
  { id: "c2", name: "Boris Kane", color: "#ef4444" },
];

function ledger(): FactorLedgerSnapshot {
  return {
    recordedTurn: 512,
    byCandidateNational: [
      {
        candidateId: "c1",
        nominalWeight: 10_000,
        finalVotes: 12_500,
        factors: FACTOR_ORDER.map((key, i) => ({
          key,
          label: key === "reach" ? "Name recognition" : key,
          voteDelta: (i - 4) * 250,
          ...(key === "reach" ? { multiplier: 1.08 } : {}),
        })),
        bucketAppeal: [
          { candidateId: "c1", bucket: "race:white", appealShare: 0.62, demoEP: -1, demoSP: 0 },
        ],
      },
      {
        candidateId: "c2",
        nominalWeight: 9_000,
        finalVotes: 11_000,
        factors: FACTOR_ORDER.map((key) => ({ key, label: key, voteDelta: 100 })),
      },
    ],
  };
}

describe("FactorLedgerCard", () => {
  it("renders nothing when the ledger is absent", () => {
    const { container } = render(<FactorLedgerCard data={undefined} candidates={CANDIDATES} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for an empty ledger", () => {
    const { container } = render(
      <FactorLedgerCard
        data={{ recordedTurn: 1, byCandidateNational: [] }}
        candidates={CANDIDATES}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the title, the leader by default, and the factor rows", () => {
    render(<FactorLedgerCard data={ledger()} candidates={CANDIDATES} />);
    expect(screen.getByText("Factor Ledger")).toBeTruthy();
    // Leader (byCandidateNational[0]) is the default focus. Name appears in both
    // the focus row and the selector option.
    expect(screen.getAllByText("Ada Vance").length).toBeGreaterThan(0);
    expect(screen.getByText("Name recognition")).toBeTruthy();
    expect(screen.getByText(/1\.08/)).toBeTruthy();
    expect(screen.getByText(/turn 512/)).toBeTruthy();
    // Projected votes total.
    expect(screen.getByText(/12,500/)).toBeTruthy();
  });

  it("shows the bucket-appeal breakdown for an owned candidate", () => {
    render(<FactorLedgerCard data={ledger()} candidates={CANDIDATES} />);
    expect(screen.getByText("Where the support comes from")).toBeTruthy();
    expect(screen.getByText(/62\.0/)).toBeTruthy();
  });

  it("names the people in each bucket rather than printing the engine's key", () => {
    // `race:white` is an internal id. Reading it off the page asked players to
    // learn the model's field names to find out whose support this is.
    render(<FactorLedgerCard data={ledger()} candidates={CANDIDATES} />);
    expect(screen.getByText("White voters")).toBeTruthy();
    expect(screen.queryByText("race:white")).toBeNull();
  });

  it("uses the country's own naming when it has a table", () => {
    render(<FactorLedgerCard data={ledger()} candidates={CANDIDATES} countryId="US" />);
    expect(screen.getByText("White voters")).toBeTruthy();
  });

  it("offers a selector for every candidate that carries a ledger row", () => {
    render(<FactorLedgerCard data={ledger()} candidates={CANDIDATES} />);
    const select = screen.getByLabelText("Candidate") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.querySelectorAll("option").length).toBe(2);
  });
});
