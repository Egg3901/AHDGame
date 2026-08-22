/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnionServicesPanel } from "./UnionServicesPanel";

describe("UnionServicesPanel approval forecast", () => {
  it("shows why funded services may or may not raise approval", () => {
    render(
      <UnionServicesPanel
        unionId="u1"
        countryId="DD"
        members={1_000}
        annualWage={100}
        treasury={1_000_000}
        duesPerWorkerAnnual={4}
        activeServices={["healthFund", "training"]}
        approval={50}
        politicalContributionPct={0}
        isHead
        suspended={false}
        onSaved={() => {}}
      />
    );

    expect(screen.getByText(/Approval is 50\.0 and is moving toward 54\.0/)).toBeTruthy();
    expect(screen.getByText(/Next funded turn: 51\.5 \(\+1\.5\)/)).toBeTruthy();
    expect(screen.getByText(/Services add \+19 to the target/)).toBeTruthy();
  });
});
