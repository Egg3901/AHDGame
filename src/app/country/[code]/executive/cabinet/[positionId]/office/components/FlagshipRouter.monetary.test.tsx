/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FlagshipRouter } from "./FlagshipRouter";

afterEach(cleanup);

const monetary = {
  monetary: {
    primeRate: 2.75,
    primeRateHistory: [],
    chairName: "Jane Chair",
    sovereignRate: 4.5,
    confidencePremium: 0.01,
    investorConfidence: 50,
    confidenceBaseline: 70,
    fxRate: null,
    fxBand: null,
    reserveBalance: 1000,
    forexRevenue: 500,
    debtOp: { active: false, expiresTurn: null, cooldownUntilTurn: 0, boostPerTurn: null },
  },
  debtPrincipal: 1_000_000,
  sovereignBondsOutstanding: 600_000,
  sovereignBondProfile: null,
  currentTurn: 200,
};

describe("FlagshipRouter — monetary", () => {
  it("renders the Monetary flagship for a finance seat", () => {
    render(
      <FlagshipRouter
        countryCode="us"
        countryId="US"
        positionId="secretary_of_treasury"
        canAct={false}
        currencySymbol="$"
        regions={[]}
        targetCountries={[]}
        onUpdate={vi.fn()}
        hasForce={false}
        force={null}
        estates={null}
        energy={null}
        infra={null}
        monetary={monetary}
      />
    );
    expect(screen.getByText("Central Bank Prime Rate")).toBeTruthy();
    expect(screen.getByText("Debt Management Operation")).toBeTruthy();
  });
});
